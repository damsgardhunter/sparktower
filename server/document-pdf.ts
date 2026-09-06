/**
 * Renders a Nova document to a real PDF.
 *
 * The editor lays blocks out on a per-page grid, so the PDF has to honour that
 * grid rather than reflowing everything into one column — a two-column layout
 * the builder arranged by hand should come out two columns. That means
 * measuring each row before drawing it, because a row's height is its tallest
 * block and a row that doesn't fit has to move to a fresh page whole.
 *
 * Markdown is handled deliberately narrowly: the inline marks people actually
 * type (**bold**, *italic*, `code`) plus the block shapes the model is told to
 * produce. A full CommonMark implementation would be a lot of surface area for
 * output nobody asked to be arbitrary.
 */
import PDFDocument from "pdfkit";
import type { DocumentPage, DocumentSettings, DocumentBlock } from "@shared/documents";
import { normalizePage } from "@shared/documents";

const PAGE_MARGIN = 54;
const GUTTER = 18;
/** Vertical space between grid rows. */
const ROW_GAP = 16;

const FONT = {
  regular: "Helvetica",
  bold: "Helvetica-Bold",
  italic: "Helvetica-Oblique",
  mono: "Courier",
};

const SIZE = {
  title: 30,
  subtitle: 14,
  heading: 15,
  body: 10,
  small: 8.5,
  quote: 12,
};

interface InlineRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

/**
 * Splits a line into styled runs.
 *
 * Written as a single scan rather than nested replaces so that overlapping
 * marks degrade to literal text instead of producing stray asterisks.
 */
export function parseInline(line: string): InlineRun[] {
  const runs: InlineRun[] = [];
  let buffer = "";
  let i = 0;

  const flush = () => {
    if (buffer) { runs.push({ text: buffer }); buffer = ""; }
  };

  while (i < line.length) {
    const rest = line.slice(i);

    const bold = rest.match(/^\*\*([^*]+)\*\*/);
    if (bold) { flush(); runs.push({ text: bold[1], bold: true }); i += bold[0].length; continue; }

    const starItalic = rest.match(/^\*([^*]+)\*/);
    if (starItalic) { flush(); runs.push({ text: starItalic[1], italic: true }); i += starItalic[0].length; continue; }

    /*
     * Underscore emphasis only counts at word boundaries. Treating it
     * intra-word turned identifiers like `checkin_day_of_week` into
     * "checkin<i>day</i>of_week" — and field names full of underscores are
     * exactly what a spec document is made of.
     */
    const atWordStart = i === 0 || !/[A-Za-z0-9]/.test(line[i - 1]);
    const underscoreItalic = atWordStart ? rest.match(/^_([^_\s][^_]*)_(?![A-Za-z0-9])/) : null;
    if (underscoreItalic) {
      flush();
      runs.push({ text: underscoreItalic[1], italic: true });
      i += underscoreItalic[0].length;
      continue;
    }

    const code = rest.match(/^`([^`]+)`/);
    if (code) { flush(); runs.push({ text: code[1], code: true }); i += code[0].length; continue; }

    buffer += line[i];
    i++;
  }
  flush();
  return runs.length ? runs : [{ text: "" }];
}

/** Splits a markdown table into a header row and body rows. */
function parseTable(content: string): { header: string[]; rows: string[][] } | null {
  const lines = content.trim().split("\n").map((l) => l.trim()).filter(Boolean);
  const cells = (line: string) =>
    line.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

  const tableLines = lines.filter((l) => l.includes("|"));
  if (tableLines.length < 2) return null;

  const header = cells(tableLines[0]);
  // The |---|---| separator carries no data.
  const body = tableLines
    .slice(1)
    .filter((l) => !/^\|?[\s:-]+\|[\s:|-]*$/.test(l))
    .map(cells)
    .map((r) => {
      const row = r.slice(0, header.length);
      while (row.length < header.length) row.push("");
      return row;
    });

  return { header, rows: body };
}

type Doc = PDFKit.PDFDocument;

/**
 * Replaces characters the standard PDF fonts can't encode.
 *
 * pdfkit's built-in Helvetica is WinAnsi, and anything outside it is dropped
 * silently — which turned "Check‑In" into "Check In" and "≤72h" into garbage.
 * Models reach for these characters constantly, so mapping them to ASCII
 * equivalents is the difference between a clean document and a corrupted one.
 */
export function toWinAnsi(input: string): string {
  const map: Record<string, string> = {
    "\u2011": "-",      // non-breaking hyphen
    "\u2012": "-", "\u2043": "-", "\u2212": "-",
    "\u2264": "<=", "\u2265": ">=", "\u2260": "!=",
    "\u2248": "~", "\u00d7": "x", "\u00f7": "/",
    "\u2192": "->", "\u2190": "<-", "\u21d2": "=>", "\u2194": "<->",
    "\u2713": "*", "\u2714": "*", "\u2717": "x", "\u2718": "x",
    "\u25cf": "-", "\u25aa": "-", "\u25b8": ">", "\u25b6": ">",
    "\u00a0": " ", "\u2009": " ", "\u202f": " ", "\u200b": "",
    "\u2032": "'", "\u2033": '"',
    "\u00b1": "+/-", "\u221e": "infinity",
  };
  let out = input.replace(/[\u2011\u2012\u2043\u2212\u2264\u2265\u2260\u2248\u00d7\u00f7\u2192\u2190\u21d2\u2194\u2713\u2714\u2717\u2718\u25cf\u25aa\u25b8\u25b6\u00a0\u2009\u202f\u200b\u2032\u2033\u00b1\u221e]/g,
    (c) => map[c] ?? c);
  // Anything still outside Latin-1 would be dropped, so make it visible as "?".
  out = out.replace(/[^\u0000-\u00ff\u2018\u2019\u201c\u201d\u2013\u2014\u2026\u2022\u20ac\u2122]/g, "?");
  return out;
}

interface LaidOutWord {
  text: string;
  run: InlineRun;
  width: number;
  /**
   * True when this word had no whitespace before it in the source, so it must
   * be drawn flush against the previous one. Without this, punctuation that
   * follows a styled run ("**72h**, next") gets a space inserted in front of
   * it and reads as "72h , next".
   */
  glued: boolean;
}
interface LaidOutLine { words: LaidOutWord[]; width: number }

const LINE_GAP = 2;
const lineHeight = (size: number) => size * 1.18 + LINE_GAP;

function fontFor(run: InlineRun): string {
  return run.code ? FONT.mono : run.bold ? FONT.bold : run.italic ? FONT.italic : FONT.regular;
}

/**
 * Lays styled runs out into lines, measuring every word.
 *
 * Written by hand rather than leaning on pdfkit's `continued` chaining,
 * because that chaining broke a line after every styled run and — worse —
 * disagreed with heightOfString, so measured heights came out short and blocks
 * drew on top of each other. One function now produces the lines that both the
 * measure pass and the draw pass use, so they cannot diverge.
 */
function layoutRuns(doc: Doc, runs: InlineRun[], width: number, size: number): LaidOutLine[] {
  const lines: LaidOutLine[] = [];
  let current: LaidOutLine = { words: [], width: 0 };
  const spaceWidth = (run: InlineRun) => {
    doc.font(fontFor(run)).fontSize(size);
    return doc.widthOfString(" ");
  };

  let previousRunEndedWithSpace = true;

  for (const run of runs) {
    const cleaned = toWinAnsi(run.text);
    if (!cleaned) continue;

    const startsWithSpace = /^\s/.test(cleaned);
    const endsWithSpace = /\s$/.test(cleaned);

    const segments = cleaned.split("\n");
    segments.forEach((segment, segIndex) => {
      if (segIndex > 0) {
        if (current.words.length) lines.push(current);
        current = { words: [], width: 0 };
      }
      // A single word wider than the column has to be broken, or it draws
      // straight over whatever is in the next column.
      const words: string[] = [];
      for (const raw of segment.split(/\s+/).filter(Boolean)) {
        doc.font(fontFor(run)).fontSize(size);
        if (doc.widthOfString(raw) <= width) { words.push(raw); continue; }
        let chunk = "";
        for (const char of raw) {
          if (chunk && doc.widthOfString(chunk + char) > width) {
            words.push(chunk);
            chunk = char;
          } else {
            chunk += char;
          }
        }
        if (chunk) words.push(chunk);
      }

      words.forEach((word, wordIndex) => {
        doc.font(fontFor(run)).fontSize(size);
        const w = doc.widthOfString(word);
        // Only the run's very first word can be glued; the rest were
        // separated by whitespace by definition.
        const glued = wordIndex === 0 && segIndex === 0
          && !startsWithSpace && !previousRunEndedWithSpace && current.words.length > 0;
        const gap = current.words.length && !glued ? spaceWidth(run) : 0;

        if (current.words.length && !glued && current.width + gap + w > width) {
          lines.push(current);
          current = { words: [{ text: word, run, width: w, glued: false }], width: w };
        } else {
          current.words.push({ text: word, run, width: w, glued });
          current.width += gap + w;
        }
      });
    });

    previousRunEndedWithSpace = endsWithSpace;
  }
  if (current.words.length) lines.push(current);
  return lines.length ? lines : [{ words: [], width: 0 }];
}

function linesHeight(lines: LaidOutLine[], size: number): number {
  return Math.max(1, lines.length) * lineHeight(size);
}

/** Draws pre-laid-out lines at an exact position. */
function drawLines(doc: Doc, lines: LaidOutLine[], x: number, y: number, size: number, color: string) {
  let cursor = y;
  for (const line of lines) {
    let cursorX = x;
    line.words.forEach((word, i) => {
      if (i > 0 && !word.glued) {
        doc.font(fontFor(word.run)).fontSize(size);
        cursorX += doc.widthOfString(" ");
      }
      doc.font(fontFor(word.run)).fontSize(size).fillColor(color);
      doc.text(word.text, cursorX, cursor, { lineBreak: false });
      cursorX += word.width;
    });
    cursor += lineHeight(size);
  }
}

/** Measure-and-draw pair for one styled string, so the two always agree. */
function textHeight(doc: Doc, text: string, width: number, size: number): number {
  return linesHeight(layoutRuns(doc, parseInline(text), width, size), size);
}

function drawText(doc: Doc, text: string, x: number, y: number, width: number, size: number, color: string, force?: Partial<InlineRun>) {
  const runs = force ? parseInline(text).map((r) => ({ ...r, ...force })) : parseInline(text);
  drawLines(doc, layoutRuns(doc, runs, width, size), x, y, size, color);
}

/** Below this, a table column is too narrow to read and we stack instead. */
const MIN_TABLE_COL_WIDTH = 62;
/** Table cell padding, and the space a header row occupies. */
const CELL_PAD = 4;

/**
 * A block with no content contributes nothing to the page.
 *
 * Printing its chrome — an empty callout box, a bare table rule — makes an
 * unfinished document look broken rather than unfinished. Headings are the
 * exception: their headline is the content.
 */
function isRenderable(block: DocumentBlock): boolean {
  if (block.kind === "spacer") return true;
  if (block.kind === "heading") return !!(block.content.trim() || block.headline.trim());
  return !!block.content.trim();
}

/** Splits prose into the largest units a page break may fall between. */
function proseUnits(content: string): string[] {
  const paragraphs = content.trim().split(/\n\s*\n/).map((p) => p.replace(/\n/g, " ").trim()).filter(Boolean);
  return paragraphs.length ? paragraphs : [];
}

/** Sentence-level split, for a single paragraph taller than a whole page. */
function sentenceUnits(paragraph: string): string[] {
  const matched = paragraph.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g);
  return matched ? matched.map((x) => x.trim()).filter(Boolean) : [paragraph];
}

function listUnits(content: string): string[] {
  return content.trim().split("\n").map((l) => l.trim()).filter(Boolean);
}

/**
 * Renders a table row-by-row as stacked records.
 *
 * A seven-column table on a portrait page gives each column about 70pt, which
 * wraps every cell into a ragged tower and reads as a wall of fragments. When
 * the columns get that narrow, one record per block — "Field: value" lines —
 * carries the same information legibly. Nothing is dropped either way.
 */
function tableAsRecords(table: { header: string[]; rows: string[][] }): string[][] {
  return table.rows.map((row) =>
    row.map((cell, i) => `**${table.header[i] || `Column ${i + 1}`}:** ${cell}`).filter(Boolean),
  );
}

interface BlockMetrics {
  /** Natural height with no page limit. */
  height: number;
}

/** Natural height of a block. Same branches as the draw, so they agree. */
function measureBlock(doc: Doc, block: DocumentBlock, width: number): number {
  if (!isRenderable(block)) return 0;

  switch (block.kind) {
    case "spacer":
      return 24;
    case "heading":
      return textHeight(doc, block.content.trim() || block.headline, width, SIZE.heading) + 8;
    case "quote":
      return textHeight(doc, block.content.trim(), width - 14, SIZE.quote) + 12;
    case "callout":
      return textHeight(doc, block.content.trim(), width - 24, SIZE.body) + 22;
    case "metrics":
      return listUnits(block.content).reduce((h, line) => {
        const value = line.replace(/^[-*]\s*/, "").split(":").slice(1).join(":").trim();
        return h + SIZE.small + 2 + textHeight(doc, value || " ", width, SIZE.body) + 6;
      }, 4);
    case "bullets":
    case "numbered":
      return listUnits(block.content).reduce(
        (h, line) => h + textHeight(doc, line.replace(/^\s*(?:[-*+]|\d+\.)\s*/, ""), width - 16, SIZE.body) + 4,
        2,
      );
    case "table": {
      const table = parseTable(block.content);
      if (!table) return textHeight(doc, block.content, width, SIZE.body);
      return measureTable(doc, table, width).total;
    }
    default: {
      const units = proseUnits(block.content);
      if (!units.length) return SIZE.body + 6;
      return units.reduce((h, para) => h + textHeight(doc, para, width, SIZE.body) + 8, 0);
    }
  }
}

/** Per-row heights of a table, plus its header height and total. */
function measureTable(doc: Doc, table: { header: string[]; rows: string[][] }, width: number) {
  const colWidth = width / Math.max(1, table.header.length);

  if (colWidth < MIN_TABLE_COL_WIDTH) {
    // Stacked fallback: each record is a small block of "Field: value" lines.
    const records = tableAsRecords(table);
    const rowHeights = records.map(
      (lines) => lines.reduce((h, line) => h + textHeight(doc, line, width - 10, SIZE.small) + 2, 6) + 6,
    );
    return { stacked: true, colWidth, headerHeight: 0, rowHeights, total: rowHeights.reduce((a, b) => a + b, 0) };
  }

  const headerHeight = Math.max(
    ...table.header.map((c) => textHeight(doc, c, colWidth - CELL_PAD * 2, SIZE.small)),
    SIZE.small,
  ) + 10;
  const rowHeights = table.rows.map(
    (row) => Math.max(...row.map((c) => textHeight(doc, c, colWidth - CELL_PAD * 2, SIZE.small)), SIZE.small) + 8,
  );
  return {
    stacked: false, colWidth, headerHeight, rowHeights,
    total: headerHeight + rowHeights.reduce((a, b) => a + b, 0) + 4,
  };
}

export interface DrawOutcome {
  /** Vertical space consumed. Zero means nothing was drawn. */
  height: number;
  /** The part that didn't fit, to be drawn on the next page. */
  remainder: DocumentBlock | null;
}

/**
 * Draws a block within a height budget, returning whatever didn't fit.
 *
 * This is what stops long content disappearing. Previously a block drew from
 * its origin with no bound, so a table taller than the remaining page ran off
 * the bottom edge and those rows were simply never seen. Splittable kinds
 * (prose, lists, tables) now hand back a remainder block; atomic ones ask to
 * be moved to the next page — unless `force`, which is set once we're already
 * on a fresh page and moving again would loop forever.
 */
function drawBlock(
  doc: Doc,
  block: DocumentBlock,
  x: number,
  y: number,
  width: number,
  maxHeight: number,
  accent: string,
  force = false,
): DrawOutcome {
  if (!isRenderable(block)) return { height: 0, remainder: null };

  const natural = measureBlock(doc, block, width);
  const atomic = ["heading", "quote", "callout", "spacer"].includes(block.kind);

  if (atomic) {
    if (natural > maxHeight && !force) return { height: 0, remainder: block };
    drawAtomic(doc, block, x, y, width, accent);
    return { height: natural, remainder: null };
  }

  switch (block.kind) {
    case "metrics": {
      const lines = listUnits(block.content);
      let cursor = y;
      let drawn = 0;
      for (const line of lines) {
        const [label, ...rest] = line.replace(/^[-*]\s*/, "").split(":");
        const value = rest.join(":").trim();
        /*
         * Both halves go through the inline renderer. Drawing them raw printed
         * the markdown itself — a metric reading "`checkin_submitted`
         * timestamp" showed its backticks instead of setting them in mono.
         */
        const valueHeight = textHeight(doc, value || " ", width, SIZE.body);
        const rowHeight = SIZE.small + 2 + valueHeight + 6;
        if (cursor - y + rowHeight > maxHeight && !(force && drawn === 0)) break;

        drawText(doc, label.trim(), x, cursor, width, SIZE.small, "#6b7280");
        if (value) drawText(doc, value, x, cursor + SIZE.small + 2, width, SIZE.body, "#111111", { bold: true });
        cursor += rowHeight;
        drawn++;
      }
      if (!drawn) return { height: 0, remainder: block };
      const left = lines.slice(drawn);
      return {
        height: cursor - y + 4,
        remainder: left.length ? { ...block, content: left.join("\n") } : null,
      };
    }

    case "bullets":
    case "numbered": {
      /*
       * Resolve each item's number once, up front, and carry it through to any
       * remainder verbatim.
       *
       * Numbering by loop position restarted the count at 1 on every
       * continuation page; renumbering the remainder by how many were drawn in
       * the current pass got the first continuation right and the second wrong
       * (page 3 of a 60-step list started again at 22). Absolute numbers in
       * the item list are the only version that survives an arbitrary number
       * of splits.
       */
      const items = listUnits(block.content).map((line, i) => {
        const explicit = line.match(/^\s*(\d{1,3})[.)]\s*/);
        return {
          marker: block.kind === "numbered" ? (explicit ? explicit[1] : String(i + 1)) : "",
          text: line.replace(/^\s*(?:[-*+\u2022]|\d{1,3}[.)])\s*/, ""),
        };
      });

      let cursor = y;
      let drawn = 0;
      for (const item of items) {
        const h = textHeight(doc, item.text, width - 16, SIZE.body) + 4;
        if (cursor - y + h > maxHeight && !(force && drawn === 0)) break;
        doc.font(FONT.bold).fontSize(SIZE.body).fillColor(accent);
        doc.text(block.kind === "numbered" ? `${item.marker}.` : "\u2022", x, cursor, { width: 14, lineBreak: false });
        drawText(doc, item.text, x + 16, cursor, width - 16, SIZE.body, "#1a1a1a");
        cursor += h;
        drawn++;
      }
      if (!drawn) return { height: 0, remainder: block };

      const left = items.slice(drawn);
      return {
        height: cursor - y + 2,
        remainder: left.length
          ? {
              ...block,
              content: left
                .map((item) => (block.kind === "numbered" ? `${item.marker}. ${item.text}` : `- ${item.text}`))
                .join("\n"),
            }
          : null,
      };
    }

    case "table": {
      const table = parseTable(block.content);
      if (!table) {
        if (natural > maxHeight && !force) return { height: 0, remainder: block };
        drawText(doc, block.content, x, y, width, SIZE.body, "#1a1a1a");
        return { height: natural, remainder: null };
      }
      return drawTable(doc, table, x, y, width, maxHeight, accent, force);
    }

    default: {
      // Prose: paragraph by paragraph, falling back to sentences for a single
      // paragraph too tall to fit anywhere.
      let units = proseUnits(block.content);
      if (units.length === 1 && measureBlock(doc, { ...block, content: units[0] }, width) > maxHeight) {
        units = sentenceUnits(units[0]);
      }
      let cursor = y;
      let drawn = 0;
      for (const unit of units) {
        const h = textHeight(doc, unit, width, SIZE.body) + 8;
        if (cursor - y + h > maxHeight && !(force && drawn === 0)) break;
        drawText(doc, unit, x, cursor, width, SIZE.body, "#1a1a1a");
        cursor += h;
        drawn++;
      }
      if (!drawn) return { height: 0, remainder: block };
      const left = units.slice(drawn);
      return {
        height: cursor - y,
        remainder: left.length ? { ...block, content: left.join("\n\n") } : null,
      };
    }
  }
}

/** The kinds that are all-or-nothing. */
function drawAtomic(doc: Doc, block: DocumentBlock, x: number, y: number, width: number, accent: string) {
  switch (block.kind) {
    case "spacer":
      return;
    case "heading": {
      const text = block.content.trim() || block.headline;
      drawText(doc, text, x, y, width, SIZE.heading, accent, { bold: true });
      const lineY = y + textHeight(doc, text, width, SIZE.heading) + 3;
      doc.moveTo(x, lineY).lineTo(x + Math.min(width, 48), lineY).lineWidth(2).strokeColor(accent).stroke();
      return;
    }
    case "quote": {
      const h = measureBlock(doc, block, width);
      doc.moveTo(x, y).lineTo(x, y + h - 12).lineWidth(3).strokeColor(accent).stroke();
      drawText(doc, block.content.trim(), x + 14, y + 2, width - 14, SIZE.quote, "#333333", { italic: true });
      return;
    }
    case "callout": {
      const h = measureBlock(doc, block, width);
      doc.roundedRect(x, y, width, h - 6, 4).fillOpacity(0.07).fill(accent).fillOpacity(1);
      doc.roundedRect(x, y, width, h - 6, 4).lineWidth(0.75).strokeColor(accent).stroke();
      drawText(doc, block.content.trim(), x + 12, y + 10, width - 24, SIZE.body, "#1a1a1a");
      return;
    }
  }
}

/** Draws as many table rows as fit, repeating the header on continuation. */
function drawTable(
  doc: Doc,
  table: { header: string[]; rows: string[][] },
  x: number, y: number, width: number, maxHeight: number,
  accent: string, force: boolean,
): DrawOutcome {
  const metrics = measureTable(doc, table, width);
  const toMarkdown = (rows: string[][]) =>
    [`| ${table.header.join(" | ")} |`, `|${table.header.map(() => "---").join("|")}|`,
      ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");

  if (metrics.stacked) {
    const records = tableAsRecords(table);
    let cursor = y;
    let drawn = 0;
    for (let i = 0; i < records.length; i++) {
      const h = metrics.rowHeights[i];
      if (cursor - y + h > maxHeight && !(force && drawn === 0)) break;
      doc.roundedRect(x, cursor, width, h - 6, 3).fillOpacity(0.04).fill(accent).fillOpacity(1);
      let inner = cursor + 4;
      for (const line of records[i]) {
        drawText(doc, line, x + 5, inner, width - 10, SIZE.small, "#1a1a1a");
        inner += textHeight(doc, line, width - 10, SIZE.small) + 2;
      }
      cursor += h;
      drawn++;
    }
    if (!drawn) return { height: 0, remainder: null };
    const left = table.rows.slice(drawn);
    return {
      height: cursor - y,
      remainder: left.length
        ? { id: "", kind: "table", headline: "", intent: "", content: toMarkdown(left), col: 0, row: 0, colSpan: 1, rowSpan: 1 }
        : null,
    };
  }

  const { colWidth, headerHeight, rowHeights } = metrics;
  // No point drawing a header with no rows under it.
  if (headerHeight + (rowHeights[0] ?? 0) > maxHeight && !force) {
    return { height: 0, remainder: null };
  }

  let cursor = y;
  doc.rect(x, cursor, width, headerHeight).fillOpacity(0.08).fill(accent).fillOpacity(1);
  table.header.forEach((cell, i) => {
    drawText(doc, `**${cell}**`, x + i * colWidth + CELL_PAD, cursor + 5, colWidth - CELL_PAD * 2, SIZE.small, "#111111");
  });
  cursor += headerHeight;

  let drawn = 0;
  for (let i = 0; i < table.rows.length; i++) {
    const h = rowHeights[i];
    if (cursor - y + h > maxHeight && !(force && drawn === 0)) break;
    table.rows[i].forEach((cell, c) => {
      drawText(doc, cell, x + c * colWidth + CELL_PAD, cursor + 2, colWidth - CELL_PAD * 2, SIZE.small, "#1a1a1a");
    });
    cursor += h;
    doc.moveTo(x, cursor - 3).lineTo(x + width, cursor - 3).lineWidth(0.4).strokeColor("#e5e7eb").stroke();
    drawn++;
  }

  const left = table.rows.slice(drawn);
  return {
    height: cursor - y + 4,
    remainder: left.length
      ? { id: "", kind: "table", headline: "", intent: "", content: toMarkdown(left), col: 0, row: 0, colSpan: 1, rowSpan: 1 }
      : null,
  };
}

export interface RenderInput {
  title: string;
  pages: DocumentPage[];
  settings: DocumentSettings;
  projectTitle: string;
}

/**
 * Renders to a Buffer.
 *
 * Buffered rather than streamed because the caller uploads it to object
 * storage and needs a length, and because a document large enough for
 * streaming to matter is still only a few hundred kilobytes.
 */
export interface RenderResult {
  buffer: Buffer;
  /** Total PDF pages, including the title page. */
  totalPdfPages: number;
  /**
   * Per document page, the PDF pages it occupies. A document page that spans
   * more than one is overflowing — the editor surfaces that, because "1 page"
   * in the editor meaning 5 pages in the PDF is not a difference the builder
   * should have to discover by downloading it.
   */
  pageMap: { title: string; startPdfPage: number; endPdfPage: number; pdfPages: number }[];
}

export async function renderDocumentPdf(input: RenderInput): Promise<RenderResult> {
  const accent = /^#[0-9a-f]{6}$/i.test(input.settings.accentColor || "")
    ? input.settings.accentColor
    : "#6366f1";

  const doc = new PDFDocument({
    size: "LETTER",
    margins: { top: PAGE_MARGIN, bottom: PAGE_MARGIN, left: PAGE_MARGIN, right: PAGE_MARGIN },
    info: { Title: input.title, Author: input.projectTitle },
    autoFirstPage: false,
    bufferPages: true,
  });

  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const pageWidth = 612 - PAGE_MARGIN * 2;

  /** Header/footer are drawn per PDF page, not per document page. */
  const decorate = (isTitlePage: boolean) => {
    if (isTitlePage) return;
    if (input.settings.header?.trim()) {
      const savedTop = doc.page.margins.top;
      doc.page.margins.top = 0;
      doc.font(FONT.regular).fontSize(SIZE.small).fillColor("#9ca3af");
      doc.text(toWinAnsi(input.settings.header.trim()), PAGE_MARGIN, PAGE_MARGIN - 26, {
        width: pageWidth, align: "left", lineBreak: false,
      });
      doc.page.margins.top = savedTop;
      doc.moveTo(PAGE_MARGIN, PAGE_MARGIN - 12).lineTo(612 - PAGE_MARGIN, PAGE_MARGIN - 12)
        .lineWidth(0.5).strokeColor("#e5e7eb").stroke();
    }
  };

  let contentPageNumber = 0;
  /** Which PDF pages each document page ended up spanning. */
  const pageMap: { title: string; startPdfPage: number; endPdfPage: number }[] = [];

  const startPage = (isTitlePage = false) => {
    doc.addPage();
    if (!isTitlePage) contentPageNumber++;
    decorate(isTitlePage);
    doc.y = PAGE_MARGIN;
  };

  // --- Title page -----------------------------------------------------------
  if (input.settings.titlePage) {
    startPage(true);
    doc.y = 240;
    doc.font(FONT.bold).fontSize(SIZE.title).fillColor("#111111");
    doc.text(toWinAnsi(input.title), PAGE_MARGIN, doc.y, { width: pageWidth, align: "center" });
    if (input.settings.subtitle?.trim()) {
      doc.moveDown(0.6);
      doc.font(FONT.regular).fontSize(SIZE.subtitle).fillColor("#6b7280");
      doc.text(toWinAnsi(input.settings.subtitle.trim()), PAGE_MARGIN, doc.y, { width: pageWidth, align: "center" });
    }
    doc.moveDown(1.2);
    const ruleY = doc.y;
    doc.moveTo(612 / 2 - 40, ruleY).lineTo(612 / 2 + 40, ruleY).lineWidth(2).strokeColor(accent).stroke();
    doc.moveDown(1.2);
    doc.font(FONT.regular).fontSize(SIZE.body).fillColor("#9ca3af");
    doc.text(toWinAnsi(input.projectTitle), PAGE_MARGIN, doc.y + 10, { width: pageWidth, align: "center" });
    doc.text(new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }),
      PAGE_MARGIN, doc.y + 4, { width: pageWidth, align: "center" });
  }

  // --- Content pages --------------------------------------------------------
  for (const rawPage of input.pages) {
    const page = normalizePage(rawPage);
    startPage();
    const pageStartedAt = contentPageNumber;

    if (page.isChapterPage) {
      // A chapter divider is a page with one job, so it gets the whole page.
      doc.y = 300;
      doc.font(FONT.bold).fontSize(SIZE.title - 6).fillColor(accent);
      doc.text(toWinAnsi(page.title), PAGE_MARGIN, doc.y, { width: pageWidth, align: "center" });
      if (page.purpose) {
        doc.moveDown(0.5);
        doc.font(FONT.regular).fontSize(SIZE.body).fillColor("#6b7280");
        doc.text(toWinAnsi(page.purpose), PAGE_MARGIN + 60, doc.y, { width: pageWidth - 120, align: "center" });
      }
      continue;
    }

    if (page.title?.trim()) {
      doc.font(FONT.bold).fontSize(SIZE.heading + 3).fillColor("#111111");
      doc.text(toWinAnsi(page.title.trim()), PAGE_MARGIN, doc.y, { width: pageWidth });
      doc.y += 6;
      doc.moveTo(PAGE_MARGIN, doc.y).lineTo(612 - PAGE_MARGIN, doc.y)
        .lineWidth(1).strokeColor(accent).stroke();
      doc.y += 14;
    }

    const colWidth = (pageWidth - GUTTER * (page.columns - 1)) / page.columns;
    const rows = [...new Set(page.blocks.map((b) => b.row))].sort((a, b) => a - b);
    const bottomLimit = 792 - PAGE_MARGIN;
    const widthOf = (b: DocumentBlock) => colWidth * b.colSpan + GUTTER * (b.colSpan - 1);

    for (const row of rows) {
      /*
       * A grid row is drawn as many times as it takes. Each pass draws what
       * fits in the space left on the current PDF page; anything that doesn't
       * comes back as a remainder and continues after a page break. This is
       * what keeps a long table or list from running off the bottom edge and
       * losing its tail — which is exactly what happened before.
       */
      let queue = page.blocks.filter((b) => b.row === row);
      let freshPage = false;
      let guard = 0;

      while (queue.length && guard++ < 60) {
        const available = bottomLimit - doc.y;
        const rowTop = doc.y;
        const remainders: DocumentBlock[] = [];
        let consumed = 0;

        for (const block of queue) {
          const x = PAGE_MARGIN + block.col * (colWidth + GUTTER);
          const outcome = drawBlock(doc, block, x, rowTop, widthOf(block), available, accent, freshPage);
          consumed = Math.max(consumed, outcome.height);
          if (outcome.remainder) {
            remainders.push({ ...outcome.remainder, id: block.id, col: block.col, row: block.row, colSpan: block.colSpan, rowSpan: block.rowSpan });
          }
        }

        if (consumed > 0) doc.y = rowTop + consumed + ROW_GAP;

        if (!remainders.length) break;

        // Nothing fit and we're already at the top of a page: force it, or
        // this loops forever on a block bigger than a whole page.
        if (consumed === 0 && freshPage) break;

        startPage();
        freshPage = true;
        queue = remainders;
      }
    }

    pageMap.push({ title: page.title, startPdfPage: pageStartedAt, endPdfPage: contentPageNumber });
  }

  if (!input.settings.titlePage && !input.pages.length) {
    // An empty document still has to be a valid PDF.
    startPage();
    doc.font(FONT.regular).fontSize(SIZE.body).fillColor("#9ca3af");
    doc.text("This document is empty.", PAGE_MARGIN, PAGE_MARGIN, { width: pageWidth });
  }

  // --- Footers, once the total page count is known -------------------------
  const range = doc.bufferedPageRange();
  const firstContentPage = input.settings.titlePage ? range.start + 1 : range.start;
  for (let i = range.start; i < range.start + range.count; i++) {
    if (i < firstContentPage) continue;
    doc.switchToPage(i);
    const parts: string[] = [];
    if (input.settings.footer?.trim()) parts.push(input.settings.footer.trim());
    if (input.settings.showPageNumbers) {
      parts.push(`${i - firstContentPage + 1} / ${range.start + range.count - firstContentPage}`);
    }
    if (!parts.length) continue;
    /*
     * The footer sits below the bottom margin, and pdfkit treats any write
     * past that margin as an overflow and helpfully starts a new page — which
     * appended one blank page per footer. Dropping the bottom margin for the
     * duration of the write keeps the footer where it belongs.
     */
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font(FONT.regular).fontSize(SIZE.small).fillColor("#9ca3af");
    doc.text(toWinAnsi(parts.join("   ·   ")), PAGE_MARGIN, 792 - PAGE_MARGIN + 14, {
      width: pageWidth, align: "center", lineBreak: false,
    });
    doc.page.margins.bottom = savedBottom;
  }

  doc.end();
  const buffer = await done;
  return {
    buffer,
    totalPdfPages: range.count,
    pageMap: pageMap.map((p) => ({ ...p, pdfPages: Math.max(1, p.endPdfPage - p.startPdfPage + 1) })),
  };
}
