/**
 * The Nova document builder.
 *
 * The flow is deliberately three separate steps rather than one "write me a
 * document" call:
 *
 *   plan  — Nova decides how many pages, what each page is for, and lays out a
 *           grid of blocks with a headline for each. No prose yet.
 *   fill  — once the builder is happy with the shape, Nova writes each block.
 *   publish — renders a PDF, stores it, and registers it in the Files tab.
 *
 * Splitting plan from fill is the whole point. Generating thirty pages of prose
 * and only then discovering the structure was wrong wastes the builder's
 * credits and their time; approving a layout costs neither.
 */
import { rateLimit } from "./moderation";
import type { Express } from "express";
import { getOpenAI } from "./openai-client";
import { randomUUID } from "crypto";
import { storage } from "./storage";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { requireCredits, requireFeature, modelFor, coachingDirectiveFor } from "./entitlements";
import { CREDIT_COSTS, documentFillCost, CHARGEABLE, NO_CHARGE, OUTCOME_PRICE_CENTS} from "@shared/plans";
import {
  buildOperableProjectState, stripIdFragments, collectProjectIds,
} from "./project-operations";
import { renderDocumentPdf } from "./document-pdf";
import { parseModelJson, respondToAiError } from "./ai-json";
import {
  BLOCK_KINDS, BLOCK_KIND_CONTENT_RULES, DEFAULT_SETTINGS, MAX_GRID_COLUMNS,
  MAX_PAGES, MAX_BLOCKS_PER_PAGE, normalizePage, emptyBlocks, blockWordBudget, pageWordBudget,
  type BlockKind, type DocumentPage, type DocumentSettings, type DocumentBlock,
} from "@shared/documents";

/*
 * The shared client, not a second one built here: see server/openai-client.ts.
 * Each of these files used to construct its own, duplicating the base-URL rule
 * and — once there was a default ceiling on every answer — quietly opting out
 * of it.
 */

const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

/**
 * How many pages one fill request will attempt before handing the rest back to
 * the client to ask for again.
 *
 * The number that matters isn't the page count, it's the wall-clock time: a
 * page is a model call, and a request that makes twenty of them runs for
 * minutes, which is longer than most proxies will hold a connection and long
 * enough that the builder's own edits pile up behind it.
 */
const FILL_PAGES_PER_REQUEST = 3;

/** The most versions of `pages` kept for undo. An undo, not an archive. */
const PAGES_HISTORY_DEPTH = 5;

/**
 * When a re-plan has to ask first.
 *
 * Below the word floor there is nothing much to lose and a confirmation is
 * just a dialog in the way; above it, losing more than this fraction of the
 * builder's own writing is the kind of thing they should be told about before
 * it happens rather than after.
 */
const REPLAN_MIN_WORDS_TO_GUARD = 150;
const REPLAN_MAX_DISCARD_FRACTION = 0.4;

/**
 * The document's outstanding fill failures after a run: what was already
 * waiting, minus anything that has now been written, plus whatever just
 * failed. Kept sorted-by-insertion and deduplicated, and bounded so a
 * pathological document can't grow the column without limit.
 */
function mergeFillFailures(existing: string[] | null, failed: string[], succeeded: string[]): string[] {
  const done = new Set(succeeded);
  const out: string[] = [];
  for (const id of [...(existing ?? []), ...failed]) {
    if (done.has(id) || out.includes(id)) continue;
    out.push(id);
  }
  return out.slice(-MAX_PAGES * MAX_BLOCKS_PER_PAGE);
}

/**
 * The document's `pages` as it stands, pushed onto its undo stack.
 *
 * Taken before anything that rewrites the whole structure. A re-plan is a
 * model call that decides which pages survive, and when it decides wrong the
 * prose it dropped had nowhere else to exist.
 */
function pushPagesHistory(doc: any, reason: string): { at: string; reason: string; pages: unknown }[] {
  const history = Array.isArray(doc.pagesHistory) ? (doc.pagesHistory as any[]) : [];
  return [{ at: new Date().toISOString(), reason, pages: doc.pages ?? [] }, ...history].slice(0, PAGES_HISTORY_DEPTH);
}

function parseJson(raw: string): any {
  const match = raw.match(/\{[\s\S]*\}/);
  return parseModelJson(raw);
}

/** Coerces whatever the model returned into legal, renderable pages. */
function coercePages(raw: unknown): DocumentPage[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_PAGES).map((p: any) => {
    const blocks: DocumentBlock[] = (Array.isArray(p?.blocks) ? p.blocks : [])
      .slice(0, MAX_BLOCKS_PER_PAGE)
      .map((b: any) => ({
        id: str(b?.id, 40) || randomUUID(),
        kind: (BLOCK_KINDS.includes(b?.kind) ? b.kind : "text") as BlockKind,
        headline: str(b?.headline, 200),
        intent: str(b?.intent, 600),
        content: str(b?.content, 20_000),
        col: Number(b?.col) || 0,
        row: Number(b?.row) || 0,
        colSpan: Number(b?.colSpan) || 1,
        rowSpan: Number(b?.rowSpan) || 1,
      }))
      /*
       * Keep every block that has an id. The old filter dropped blocks with no
       * headline and no content, which meant clearing a block's headline in
       * the editor deleted the block on the next autosave.
       */
      .filter((b: DocumentBlock) => !!b.id);

    return normalizePage({
      id: str(p?.id, 40) || randomUUID(),
      title: str(p?.title, 200),
      purpose: str(p?.purpose, 600),
      columns: Math.max(1, Math.min(MAX_GRID_COLUMNS, Number(p?.columns) || 1)),
      isChapterPage: p?.isChapterPage === true,
      blocks,
    });
  });
}

function coerceSettings(raw: any): DocumentSettings {
  return {
    header: str(raw?.header, 160),
    footer: str(raw?.footer, 160),
    showPageNumbers: raw?.showPageNumbers !== false,
    titlePage: raw?.titlePage === true,
    subtitle: str(raw?.subtitle, 200),
    accentColor: /^#[0-9a-f]{6}$/i.test(raw?.accentColor || "")
      ? raw.accentColor
      : DEFAULT_SETTINGS.accentColor,
  };
}

/** The layout rules, shared by the planner and the re-planner. */
const LAYOUT_DIRECTIVE = `How to lay out a page:
- Use the SMALLEST grid that reads well. One column is the right answer for prose-heavy pages; two for anything comparative or side-by-side; three or four only for metric rows and short parallel lists. Never spread thin content across a wide grid to fill space.
- Grids are ${MAX_GRID_COLUMNS} columns at most. A block spans 1 to ${MAX_GRID_COLUMNS} columns and 1 to 4 rows.
- Blocks are placed by "col" and "row", both zero-based, and must not overlap.
- Every page opens with a heading block spanning the full width, unless the page is a chapter divider. That heading must NOT repeat the page title — the page title is already printed above it. Use it to name the first section instead.
- Use "rowSpan": 1 unless a tall block genuinely needs to sit beside several shorter ones in another column.
- At most ${MAX_BLOCKS_PER_PAGE} blocks on a page, and far fewer than that in practice: a single printed page holds roughly 800 words, so 4-6 blocks is right for one page and more than 8 means each block gets a sentence. Fewer, larger blocks beat many small ones.
- A one-page document is ONE page that actually fits on one page. Plan its content accordingly — the blocks you specify will be written to a word budget derived from the space they occupy, so ten blocks on one page produces ten cramped fragments.
- Tables get at most 4 columns. More than that doesn't fit a portrait page.
- Give every block a "headline" — the one-line plan for what goes there — and an "intent" saying what it should contain and roughly how long. The builder reads these to approve the shape before anything is written, so they have to be specific: "Three-column table of the weekly prompt fields with type and example" not "table".
- Leave "content" empty. That gets written later.

Block kinds: ${BLOCK_KINDS.join(", ")}.

Long documents: if the document needs chapters, insert a page with "isChapterPage": true, a chapter title and no blocks before each chapter's content pages. Use a title page ("titlePage": true in settings) for anything over about four pages.

Never create a content page for the title, cover or table of contents. The title page is generated from "settings" and page numbers are automatic — a "Title Page" entry in "pages" produces a second, duplicate one.`;


/**
 * Shortens overflowing pages until they fit, measuring between passes.
 *
 * Shared by the fill (which verifies its own output) and the explicit Tighten
 * action. Iterative because a single instruction — even one carrying a word
 * budget — comes back over; measuring the real render and telling the model
 * the exact factor to cut by is what converges.
 */
async function tightenPages(opts: {
  title: string;
  pages: DocumentPage[];
  settings: DocumentSettings;
  projectTitle: string;
  ent: any;
  /** Only these page indexes; omit for every overflowing page. */
  only?: number[];
  maxPasses?: number;
  /** Project entity ids, so a leaked id fragment can be stripped. */
  knownIds?: string[];
}): Promise<{ pages: DocumentPage[]; rewritten: number; passes: number; stillOverflowing: number; totalPdfPages: number; failed: string[] }> {
  let pages = opts.pages.map(normalizePage);
  const failed: string[] = [];
  let rewritten = 0;
  let passes = 0;

  const measure = async (candidate: DocumentPage[]) =>
    (await renderDocumentPdf({
      title: opts.title, pages: candidate,
      settings: opts.settings, projectTitle: opts.projectTitle,
    }));

  let render = await measure(pages);
  const overflowing = (map: typeof render.pageMap) =>
    map.map((p, i) => (p.pdfPages > 1 && (!opts.only || opts.only.includes(i)) ? i : -1)).filter((i) => i >= 0);

  for (let pass = 1; pass <= (opts.maxPasses ?? 3); pass++) {
    const targets = overflowing(render.pageMap);
    if (!targets.length) break;
    passes = pass;

    const updates = new Map<string, string>();

    for (const index of targets) {
      const page = pages[index];
      const printed = render.pageMap[index].pdfPages;
      const filled = page.blocks.filter((b) => b.content.trim() && b.kind !== "spacer");
      if (!filled.length) continue;

      const currentWords = filled.reduce((n, b) => n + b.content.trim().split(/\s+/).length, 0);
      const targetWords = Math.max(60, Math.round((currentWords / printed) * 0.88));
      const cutPercent = Math.max(5, Math.round((1 - targetWords / currentWords) * 100));

      try {
        const completion = await getOpenAI().chat.completions.create({
          model: modelFor(opts.ent),
          messages: [
            {
              role: "system",
              content: `You are Nova, cutting a page of a document down so it fits on one printed page. ${coachingDirectiveFor(opts.ent)}

This page currently prints across ${printed} pages and must fit on ONE. It holds ${currentWords} words and needs to come down to about ${targetWords} — a cut of roughly ${cutPercent}%. That figure is measured from the actual rendered page, not estimated, so treat it as the requirement.

You are editing, not rewriting. Keep every decision, number, field name, threshold and constraint that carries information. Cut what doesn't: preamble, restatements of the heading, hedging, "it is important to note", explanations of why a section exists, and any row or bullet that repeats another. Prefer dropping whole low-value items over shortening every item into fragments.

Keep every block in the form it already has. A table stays a markdown table, a bulleted list stays one bullet per line, a numbered list stays one step per line. Do not flatten a list or a table into a paragraph to save space — that loses the structure the builder approved. Tables cost far more vertical space per word than prose, so cut their rows and columns first: at most 4 columns, at most 6 rows, cells under 8 words.

One item per line. Never put "1) ... 2) ... 3) ..." on a single line.

Respond ONLY with valid JSON (no markdown, no code fences):
{ "blocks": [ { "id": "exact id", "content": "the shortened content" } ] }`,
            },
            {
              role: "user",
              content: [
                `DOCUMENT: ${opts.title}`,
                `PAGE: ${page.title}\nPurpose: ${page.purpose || "(none)"}`,
                `BLOCKS\n${filled.map((b) => [
                  `--- id: ${b.id} (${b.kind}) — MAXIMUM ${blockWordBudget(page, b)} words`,
                  `headline: ${b.headline}`,
                  `current (${b.content.trim().split(/\s+/).length} words):`,
                  b.content,
                ].join("\n")).join("\n\n")}`,
              ].join("\n\n"),
            },
          ],
        });

        const parsed = parseJson(completion.choices[0].message.content ?? "");
        for (const entry of Array.isArray(parsed.blocks) ? parsed.blocks : []) {
          const id = str(entry?.id, 40);
          const content = stripIdFragments(str(entry?.content, 20_000), opts.knownIds ?? []);
          if (id && content) updates.set(id, content);
        }
      } catch (err) {
        console.error(`Tighten pass ${pass} failed for page ${index}:`, err);
        failed.push(page.title || `Page ${index + 1}`);
      }
    }

    if (!updates.size) break;
    rewritten += updates.size;

    pages = pages.map((page) => normalizePage({
      ...page,
      blocks: page.blocks.map((b) => (updates.has(b.id) ? { ...b, content: updates.get(b.id)! } : b)),
    }));
    render = await measure(pages);
  }

  return {
    pages,
    rewritten,
    passes,
    stillOverflowing: overflowing(render.pageMap).length,
    totalPdfPages: render.totalPdfPages,
    failed,
  };
}

export function registerDocumentRoutes(app: Express) {
  /** Every document on a project, newest edit first. */
  app.get("/api/projects/:id/documents", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      if (!(await isMember(userId, req.params.id))) return res.status(403).json({ message: "Unauthorized" });
      const documents = await storage.getProjectDocuments(req.params.id);
      // The list doesn't need the page bodies, and a 30-page document's worth
      // of JSON per row makes the Files tab crawl.
      res.json(documents.map((d) => ({
        ...d,
        pages: undefined,
        pageCount: Array.isArray(d.pages) ? (d.pages as DocumentPage[]).length : 0,
        /** Blocks still empty. Without it, a list with the pages stripped can't tell a finished document from a skeleton. */
        pendingBlocks: Array.isArray(d.pages) ? emptyBlocks(d.pages as DocumentPage[]).length : 0,
      })));
    } catch (error) {
      console.error("List documents error:", error);
      res.status(500).json({ message: "Failed to load documents" });
    }
  });

  /**
   * Nova plans the document.
   *
   * Takes the title and description of what's needed — usually straight off a
   * task — and returns the page plan plus a laid-out grid of headlined blocks.
   */
  app.post("/api/projects/:id/documents/plan", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any).id;
      const projectId = req.params.id;
      if (!(await isMember(userId, projectId))) return res.status(403).json({ message: "Unauthorized" });

      const project = await storage.getProject(projectId);
      if (!project) return res.status(404).json({ message: "Project not found" });

      const ent = await requireFeature(res, userId, "aiMilestones", "The Nova document builder");
      if (!ent) return;

      const { title, description, sourceTaskId, pageHint } = req.body as {
        title?: string; description?: string; sourceTaskId?: string; pageHint?: number;
      };
      if (!title?.trim()) return res.status(400).json({ message: "What's the document called?" });

      // One price for the whole document: taken here, at the plan. Every fill,
      // re-plan and tighten inside it afterwards is free.
      if (!(await requireCredits(res, userId, CHARGEABLE, "Writing your document", { outcome: "document", projectId, action: "documentPlan" }))) return;

      // No ids: this path writes prose, and a model shown ids cites them.
      const state = await buildOperableProjectState(projectId, { includeIds: false });

      const completion = await getOpenAI().chat.completions.create({
        model: modelFor(ent),
        messages: [
          {
            role: "system",
            content: `You are Nova, planning the structure of a document a builder needs to produce. ${coachingDirectiveFor(ent)}

Decide how many pages this genuinely needs. A one-page spec is one page — do not pad it. A business plan may be twenty or thirty. Be honest about length: the builder is going to execute against this.

${LAYOUT_DIRECTIVE}

Respond ONLY with valid JSON (no markdown, no code fences):
{
  "title": "the document's title",
  "subtitle": "a short subtitle, or empty",
  "kind": "spec" | "plan" | "report" | "brief" | "proposal" | "other",
  "approach": "2-4 sentences on how you're structuring this and why that shape fits the ask.",
  "settings": { "header": "", "footer": "", "showPageNumbers": true, "titlePage": false, "subtitle": "" },
  "outline": [ { "title": "page title", "purpose": "what this page does" } ],
  "pages": [
    {
      "title": "", "purpose": "", "columns": 1, "isChapterPage": false,
      "blocks": [ { "kind": "heading", "headline": "", "intent": "", "col": 0, "row": 0, "colSpan": 1, "rowSpan": 1 } ]
    }
  ]
}
"outline" and "pages" must describe the same pages in the same order.`,
          },
          {
            role: "user",
            content: [
              `DOCUMENT NEEDED\n${title.trim()}`,
              description?.trim() ? `WHAT IT HAS TO CONTAIN\n${description.trim().slice(0, 4000)}` : null,
              pageHint ? `The builder expects roughly ${Math.max(1, Math.min(MAX_PAGES, Math.round(pageHint)))} pages.` : null,
              `THE PROJECT THIS IS FOR\n${state}`,
            ].filter(Boolean).join("\n\n"),
          },
        ],
      });

      let parsed: any;
      try {
        parsed = parseJson(completion.choices[0].message.content ?? "");
      } catch (err) {
        console.error("Document plan parse failed:", err);
        return res.status(502).json({ message: "Nova returned an unreadable plan. Please try again.", code: "model_unreadable" });
      }

      let pages = coercePages(parsed.pages);
      /*
       * The title page is generated from settings, so a page the model also
       * titled "Title Page" is a duplicate. Told not to in the prompt; dropped
       * here because it does it anyway.
       */
      if (pages.length > 1 && /^(title page|cover|cover page|table of contents|contents)$/i.test(pages[0].title.trim())) {
        pages = pages.slice(1);
      }
      if (!pages.length) {
        return res.status(502).json({ message: "Nova couldn't work out a structure for that. Try describing the document differently.", code: "model_unreadable" });
      }

      const settings = coerceSettings({
        ...parsed.settings,
        subtitle: parsed.settings?.subtitle || parsed.subtitle,
        // Anything long enough to need navigation gets a title page.
        titlePage: parsed.settings?.titlePage === true || pages.length > 4,
      });

      const document = await storage.createDocument({
        projectId,
        createdById: userId,
        title: str(parsed.title, 200) || title.trim(),
        prompt: [title.trim(), description?.trim()].filter(Boolean).join("\n\n").slice(0, 4000),
        sourceTaskId: sourceTaskId || null,
        kind: str(parsed.kind, 40) || "document",
        status: "draft",
        outline: (Array.isArray(parsed.outline) ? parsed.outline : []).slice(0, MAX_PAGES).map((o: any) => ({
          title: str(o?.title, 200),
          purpose: str(o?.purpose, 600),
        })),
        pages,
        settings,
      } as any);

      await storage.deductCredits(userId, CHARGEABLE);
      res.json({
        document,
        approach: str(parsed.approach, 1000),
        creditsCharged: 0, chargedCents: OUTCOME_PRICE_CENTS.document,
      });
    } catch (error) {
      console.error("Document plan error:", error);
      respondToAiError(res, error, "Nova couldn't plan that document");
    }
  });

  app.get("/api/documents/:docId", isAuthenticated, async (req: any, res) => {
    const doc = await loadDocument(req, res);
    if (!doc) return;
    res.json(doc);
  });

  /**
   * Saves the builder's edits: title, settings, and the pages themselves.
   *
   * Pages come back through normalizePage, so a drag that dropped two blocks
   * on the same cell is resolved here rather than being stored broken and
   * discovered at print time.
   */
  app.patch("/api/documents/:docId", isAuthenticated, async (req: any, res) => {
    try {
      const doc = await loadDocument(req, res);
      if (!doc) return;

      const patch: Record<string, unknown> = {};
      const { title, settings, pages, outline } = req.body as any;

      if (title !== undefined) {
        const t = str(title, 200);
        if (!t) return res.status(400).json({ message: "A document needs a title" });
        patch.title = t;
      }
      if (settings !== undefined) patch.settings = coerceSettings(settings);
      if (pages !== undefined) {
        const coerced = coercePages(pages);
        if (!coerced.length) return res.status(400).json({ message: "A document needs at least one page" });
        patch.pages = coerced;
      }
      if (outline !== undefined && Array.isArray(outline)) {
        patch.outline = outline.slice(0, MAX_PAGES).map((o: any) => ({
          title: str(o?.title, 200), purpose: str(o?.purpose, 600),
        }));
      }
      if (!Object.keys(patch).length) return res.status(400).json({ message: "Nothing to update" });

      const updated = await storage.updateDocument(doc.id, patch as any);
      res.json(updated);
    } catch (error) {
      console.error("Document update error:", error);
      res.status(500).json({ message: "Failed to save the document" });
    }
  });

  /** What a fill would cost, quoted before the builder commits to it. */
  app.get("/api/documents/:docId/fill-quote", isAuthenticated, async (req: any, res) => {
    const doc = await loadDocument(req, res);
    if (!doc) return;
    const pages = (doc.pages as DocumentPage[]) || [];
    const pending = emptyBlocks(pages);
    res.json({
      emptyBlocks: pending.length,
      totalBlocks: pages.reduce((n, p) => n + p.blocks.filter((b) => b.kind !== "spacer").length, 0),
      cost: documentFillCost(pending.length),
      perBlockCost: CREDIT_COSTS.documentBlockFill,
    });
  });

  /**
   * Nova writes the content.
   *
   * `blockId` fills one block (a re-roll on something the builder didn't like);
   * omitting it fills everything still empty. Pages are filled one request per
   * page rather than one for the whole document — a thirty-page document in a
   * single completion runs out of output tokens halfway through and returns
   * unparseable JSON.
   *
   * Two things this request deliberately is not:
   *
   * It is not unbounded. It used to accept "fill everything" and then make one
   * model call per page — up to MAX_PAGES of them, plus a PDF render between
   * tighten passes — inside a single HTTP request. That runs for minutes, dies
   * to any proxy's idle timeout with the work half done and nothing written,
   * and holds a connection the whole time. At most FILL_PAGES_PER_REQUEST
   * pages are attempted here; the response says how many are left and the
   * client asks again, so progress is saved between pages instead of at the
   * end.
   *
   * And it is not a whole-document write. The blocks it filled are merged onto
   * whatever the document says *now*, read back after the model calls return.
   * The old code snapshotted `pages` at the top of the request and PATCHed the
   * whole array back minutes later, so every edit the builder made while
   * waiting — typing in another block, moving one, renaming a page — was
   * silently reverted to the snapshot.
   */
  app.post("/api/documents/:docId/fill", isAuthenticated, rateLimit("ai"), async (req: any, res) => {
    try {
      const doc = await loadDocument(req, res);
      if (!doc) return;

      const userId = (req.user as any).id;
      const ent = await requireFeature(res, userId, "aiMilestones", "The Nova document builder");
      if (!ent) return;

      const { blockId, guidance, refill, pageIndex, retryFailed } = req.body as {
        blockId?: string; guidance?: string; refill?: boolean; pageIndex?: number; retryFailed?: boolean;
      };
      const pages = (doc.pages as DocumentPage[]) || [];
      const settings = coerceSettings(doc.settings);

      // Which blocks this run is responsible for.
      const targets: { pageIndex: number; block: DocumentBlock }[] = [];
      if (blockId) {
        pages.forEach((p, pageIndex) => {
          for (const b of p.blocks) if (b.id === blockId) targets.push({ pageIndex, block: b });
        });
        if (!targets.length) return res.status(404).json({ message: "That block isn't in this document." });
      } else if (retryFailed) {
        // Exactly the blocks a previous run couldn't write, remembered on the
        // document so the builder isn't paying to re-fill the pages that worked.
        const wanted = new Set((doc.fillFailures as string[] | null) ?? []);
        pages.forEach((p, idx) => {
          for (const b of p.blocks) if (b.kind !== "spacer" && wanted.has(b.id)) targets.push({ pageIndex: idx, block: b });
        });
        if (!targets.length) return res.status(400).json({ message: "Nothing is waiting on a retry." });
      } else if (Number.isFinite(Number(pageIndex))) {
        // One page at a time, so a builder is never stuck because the
        // whole-document run believes there's nothing left to do.
        const index = Number(pageIndex);
        const page = pages[index];
        if (!page) return res.status(400).json({ message: "That page isn't in this document." });
        for (const b of page.blocks) {
          if (b.kind === "spacer") continue;
          if (refill || !b.content.trim()) targets.push({ pageIndex: index, block: b });
        }
      } else if (refill) {
        pages.forEach((p, idx) => {
          for (const b of p.blocks) if (b.kind !== "spacer") targets.push({ pageIndex: idx, block: b });
        });
      } else {
        targets.push(...emptyBlocks(pages));
      }

      if (!targets.length) {
        return res.status(400).json({ message: "Every block already has content. Use a re-fill if you want it rewritten." });
      }

      // Grouped by page: one completion per page keeps each response small
      // enough to come back as valid JSON.
      const byPage = new Map<number, DocumentBlock[]>();
      for (const t of targets) {
        const list = byPage.get(t.pageIndex) || [];
        list.push(t.block);
        byPage.set(t.pageIndex, list);
      }

      /*
       * The bound on this request. Pages beyond it are left for the next call,
       * and `pagesRemaining` in the response is what tells the client to make
       * it. Three because that is roughly a minute of model time — long enough
       * to be worth one round trip, short enough to land inside any proxy's
       * idle timeout with the result written.
       */
      const deferred = [...byPage.keys()].sort((a, b) => a - b).slice(FILL_PAGES_PER_REQUEST);
      for (const index of deferred) byPage.delete(index);
      const attempted = new Set(targets.filter((t) => byPage.has(t.pageIndex)).map((t) => t.block.id));

      // Priced on what this request will actually attempt, not on everything
      // the builder asked for across the whole loop.
      // Free: the document was paid for at its plan. `cost` stays as the size
      // hint the client draws ("this is a big fill") and buys nothing.
      void (blockId ? CREDIT_COSTS.documentBlockFill : documentFillCost(attempted.size));
      if (!(await requireCredits(res, userId, NO_CHARGE, "filling in the document"))) return;

      const state = await buildOperableProjectState(doc.projectId, { includeIds: false });
      const knownIds = await collectProjectIds(doc.projectId);

      const filled = new Map<string, string>();
      const failedPages: string[] = [];
      /** Ids the model returned that match no block on the page it was given. */
      const unmatched: string[] = [];

      for (const [targetPage, blocks] of byPage) {
        const page = pages[targetPage];
        const allowedIds = new Set(blocks.map((b) => b.id));
        const outline = pages.map((p, i) => `${i + 1}. ${p.title}${i === targetPage ? "  <-- the page you are writing" : ""}`).join("\n");

        try {
          const completion = await getOpenAI().chat.completions.create({
            model: modelFor(ent),
            messages: [
              {
                role: "system",
                content: `You are Nova, writing the content of one page of a builder's document. ${coachingDirectiveFor(ent)}

Write what the block's headline and intent say to write, at the length the block's shape implies. This is the real deliverable, not a placeholder: be concrete, use the project's actual details, and never write "TBD", "lorem ipsum", "[insert here]" or a description of what the section would contain.

Every claim has to come from the project context you were given or be clearly framed as a decision the builder still has to make. Don't invent metrics, dates, customer names or funding numbers.

If the context includes a CODEBASE AUDIT, prefer it over the plan when describing what exists. A status report or investor update that claims a feature the audit says is missing is worse than useless — it's wrong in front of someone who matters.

Content format per block kind:
${BLOCK_KINDS.map((k) => `- ${k}: ${BLOCK_KIND_CONTENT_RULES[k]}`).join("\n")}

Markdown is limited to **bold**, *italic*, \`code\`, bullet/numbered lines and tables. No headings inside a block — heading blocks handle those.

Tables: at most 4 columns and at most 6 body rows, and keep every cell under about 12 words. A portrait page can't render more columns than that legibly — a 7-column table becomes a wall of fragments. If the data needs more fields than that, pick the 4 that matter and put the rest in a list, or split it into two tables across two blocks.

Write plain ASCII punctuation: a normal hyphen, "<=" not the less-than-or-equal sign, "x" not the multiplication sign, "->" not an arrow. Typographic quotes, dashes and ellipses are fine.

Never put an internal identifier in the content — no UUIDs, no id fragments, no database keys. Refer to a task, milestone or phase by its title. "Inventory loop-critical routes (2-3h)" is right; "Inventory loop-critical routes (0e7f, 2-3h)" is not.

Respond ONLY with valid JSON (no markdown, no code fences):
{ "blocks": [ { "id": "the block id, exactly as given", "content": "" } ] }
Return one entry per block you were asked to write, and nothing else.`,
              },
              {
                role: "user",
                content: [
                  `DOCUMENT: ${doc.title}${settings.subtitle ? ` — ${settings.subtitle}` : ""}`,
                  doc.prompt ? `WHAT THE BUILDER ASKED FOR\n${doc.prompt}` : null,
                  `ALL PAGES IN THIS DOCUMENT\n${outline}`,
                  `THIS PAGE: ${page.title}\nPurpose: ${page.purpose || "(none stated)"}\nGrid: ${page.columns} column(s)`,
                  `LENGTH BUDGET — THIS IS A HARD CONSTRAINT\nThis page is ONE printed page. Everything you write for it must fit inside ${pageWordBudget(page)} words in total, and each block has its own ceiling below. Each block below states its own budget. Going over doesn't get you a longer page, it gets the builder a document that overflows onto extra pages and stops being the one-pager they asked for. Write to the budget: cut qualifiers, drop the preamble, and prefer a short table or list over prose.`,
                  guidance?.trim() ? `THE BUILDER ADDED\n${guidance.trim().slice(0, 800)}` : null,
                  `BLOCKS TO WRITE\n${blocks.map((b) => [
                    `- id: ${b.id}`,
                    `  kind: ${b.kind}`,
                    `  headline: ${b.headline}`,
                    `  intent: ${b.intent || "(none)"}`,
                    `  width: ${b.colSpan} of ${page.columns} columns`,
                    `  MAXIMUM ${blockWordBudget(page, b)} words — a hard ceiling, not a target`,
                  ].join("\n")).join("\n")}`,
                  `PROJECT CONTEXT — use these real details\n${state}`,
                ].filter(Boolean).join("\n\n"),
              },
            ],
          });

          const parsed = parseJson(completion.choices[0].message.content ?? "");
          let appliedHere = 0;
          for (const entry of Array.isArray(parsed.blocks) ? parsed.blocks : []) {
            const id = str(entry?.id, 40);
            const content = stripIdFragments(str(entry?.content, 20_000), knownIds);
            if (!id || !content) continue;
            /*
             * Only ids belonging to the page we asked about. Counting every
             * returned entry meant a page whose model reply carried invented
             * ids still reported its blocks as filled — the response claimed
             * success while those blocks stayed empty, which is the worst
             * possible failure mode because nothing tells the builder to retry.
             */
            if (!allowedIds.has(id)) { unmatched.push(id); continue; }
            filled.set(id, content);
            appliedHere++;
          }
          if (!appliedHere) failedPages.push(page.title || `Page ${targetPage + 1}`);
        } catch (err) {
          console.error(`Document fill failed for page ${targetPage}:`, err);
          failedPages.push(page.title || `Page ${targetPage + 1}`);
        }
      }

      /*
       * Which blocks this run was asked for and did not deliver.
       *
       * Remembered on the document rather than mentioned once in this
       * response. A block that failed looks exactly like a block nobody has
       * written yet, so without this the only honest recovery was re-filling
       * the whole document and paying for the pages that already worked.
       */
      const failedBlockIds = [...attempted].filter((id) => !filled.has(id));

      if (!filled.size) {
        await storage.updateDocument(doc.id, {
          fillFailures: mergeFillFailures(doc.fillFailures as string[] | null, failedBlockIds, []),
        } as any).catch((err) => console.error("Couldn't record fill failures:", err));
        return res.status(502).json({
          message: "Nova couldn't write any of that. Please try again.",
          failedPages, failedBlockIds,
        });
      }

      /*
       * Merge onto the document as it is NOW, not as it was when this request
       * started.
       *
       * Minutes have passed and the builder has been typing the whole time:
       * autosave has written their edits, and re-sending the snapshot this
       * request opened with would delete every one of them. Only the blocks
       * this run was responsible for are touched; a block that has since been
       * deleted is simply not there to write to.
       *
       * Through normalizePage so per-kind content rules are enforced on the
       * way in — a heading block that came back as three paragraphs becomes
       * one line here rather than rendering as a wall of 15pt text.
       */
      const current = await storage.getDocument(doc.id);
      const currentPages = ((current?.pages as DocumentPage[]) || pages);
      const landed = new Set<string>();
      const nextPages = currentPages.map((page) => normalizePage({
        ...page,
        blocks: page.blocks.map((b) => {
          if (!filled.has(b.id)) return b;
          landed.add(b.id);
          return { ...b, content: filled.get(b.id)! };
        }),
      }));
      /** Written by Nova, then found to have no home: the builder deleted the block while it wrote. */
      const droppedBlocks = filled.size - landed.size;

      /*
       * Verify the fill against the plan before saving.
       *
       * A one-page document that comes back as five printed pages hasn't been
       * filled, it's been overfilled — and the builder asked for a one-pager.
       * The word budgets in the prompt get close but a model still runs over,
       * so this measures the real render and shortens any page that spills.
       * Included in the fill's price: they paid for a document that fits.
       *
       * Scoped to the pages this run wrote. Tightening a page the builder
       * filled last week, in a request they made about a different page, is a
       * rewrite they didn't ask for.
       */
      let finalPages = nextPages;
      let tightened = 0;
      let stillOverflowing = 0;
      if (!blockId) {
        const touched = [...byPage.keys()].filter((i) => i < nextPages.length);
        const project = await storage.getProject(doc.projectId);
        const result = await tightenPages({
          title: current?.title || doc.title,
          pages: nextPages,
          settings,
          projectTitle: project?.title || "",
          ent,
          only: touched,
          maxPasses: 2,
          knownIds,
        }).catch((err) => {
          console.error("Post-fill tighten failed:", err);
          return null;
        });
        if (result) {
          finalPages = result.pages;
          tightened = result.rewritten;
          stillOverflowing = result.stillOverflowing;
        }
      }

      const updated = await storage.updateDocument(doc.id, {
        pages: finalPages,
        fillFailures: mergeFillFailures(current?.fillFailures as string[] | null, failedBlockIds, [...landed]),
      } as any);

      /*
       * Nothing to charge: the whole document was bought at its plan, one
       * price however many blocks it turns out to have. The size hint is still
       * computed and reported, because the client draws "this is a big fill"
       * from it — it is just not money any more.
       */
      const actualCost = blockId
        ? CREDIT_COSTS.documentBlockFill
        : documentFillCost(filled.size);
      await storage.deductCredits(userId, NO_CHARGE);

      res.json({
        document: updated,
        blocksFilled: filled.size,
        blocksRequested: attempted.size || targets.length,
        blocksTightened: tightened,
        stillOverflowing,
        failedPages,
        failedBlockIds: (updated.fillFailures as string[]) ?? [],
        // Content Nova wrote for a block the builder deleted meanwhile. Not an
        // error, but it is why "wrote 6 blocks" can show 5 of them.
        droppedBlocks,
        /*
         * How much of the ask this request did not attempt. The client loops
         * on this rather than the server holding one connection open for the
         * whole document.
         */
        pagesRemaining: deferred.length,
        nextPageIndex: deferred.length ? deferred[0] : null,
        // Surfaced so a partial run is visible rather than silent.
        unmatchedIds: unmatched.length,
        creditsCharged: 0,
        sizeHint: actualCost,
      });
    } catch (error) {
      console.error("Document fill error:", error);
      respondToAiError(res, error, "Nova couldn't fill in the document");
    }
  });

  /**
   * Re-plans the layout of a document that's already been planned, keeping any
   * content the builder has. For "I like the idea but not this shape".
   */
  app.post("/api/documents/:docId/replan", isAuthenticated, async (req: any, res) => {
    try {
      const doc = await loadDocument(req, res);
      if (!doc) return;
      const userId = (req.user as any).id;

      const ent = await requireFeature(res, userId, "aiMilestones", "The Nova document builder");
      if (!ent) return;

      const { feedback, confirmDiscard } = req.body as { feedback?: string; confirmDiscard?: boolean };
      // Free, inside a document already paid for.
      if (!(await requireCredits(res, userId, NO_CHARGE, "a document re-plan", { action: "documentPlan" }))) return;

      const pages = (doc.pages as DocumentPage[]) || [];
      const completion = await getOpenAI().chat.completions.create({
        model: modelFor(ent),
        messages: [
          {
            role: "system",
            content: `You are Nova, restructuring a document you already planned, because the builder wants a different shape. ${coachingDirectiveFor(ent)}

${LAYOUT_DIRECTIVE}

Keep a block's "id" and its "content" when the block survives the restructure — the builder may have already written or approved that text, and losing it is not acceptable. Give genuinely new blocks an empty id.

Respond ONLY with valid JSON:
{ "approach": "2-3 sentences on what you changed", "pages": [ ... same shape as before ... ] }`,
          },
          {
            role: "user",
            content: [
              `DOCUMENT: ${doc.title}`,
              doc.prompt ? `ORIGINAL ASK\n${doc.prompt}` : null,
              feedback?.trim() ? `WHAT THE BUILDER WANTS CHANGED\n${feedback.trim().slice(0, 1500)}` : "The builder wants a cleaner structure.",
              `CURRENT STRUCTURE\n${JSON.stringify(pages.map((p) => ({
                title: p.title, purpose: p.purpose, columns: p.columns, isChapterPage: p.isChapterPage,
                blocks: p.blocks.map((b) => ({
                  id: b.id, kind: b.kind, headline: b.headline, intent: b.intent,
                  col: b.col, row: b.row, colSpan: b.colSpan, rowSpan: b.rowSpan,
                  hasContent: !!b.content.trim(),
                })),
              })))}`,
            ].filter(Boolean).join("\n\n"),
          },
        ],
      });

      let parsed: any;
      try {
        parsed = parseJson(completion.choices[0].message.content ?? "");
      } catch {
        return res.status(502).json({ message: "Nova returned an unreadable structure. Please try again.", code: "model_unreadable" });
      }

      const nextPages = coercePages(parsed.pages);
      if (!nextPages.length) {
        return res.status(502).json({ message: "Nova couldn't restructure that. Try describing what you want differently.", code: "model_unreadable" });
      }

      /*
       * Carry existing content across, so a restructure never silently
       * discards prose the builder already has.
       *
       * By id first, then by what the block actually is. Matching on id alone
       * was not enough and quietly lost work: the prompt asks for new blocks to
       * carry an empty id, and `coercePages` mints a fresh UUID for any block
       * that arrives without one — so a model that re-emits a surviving block
       * without repeating its id produces a block that is, as far as the id is
       * concerned, brand new, and its paragraphs are gone. The fallback key is
       * the parts of a block a restructure doesn't change: what it is called,
       * what kind it is, and where on its page it sits. Each source block is
       * spent once, so two blocks with the same headline can't both claim it.
       */
      const written = pages.flatMap((p, pageIdx) => p.blocks
        .filter((b) => b.content.trim())
        .map((b) => ({ block: b, pageIdx })));
      const byId = new Map(written.map((w) => [w.block.id, w] as const));
      const shapeKey = (b: DocumentBlock, pageIdx: number) =>
        `${pageIdx}|${b.kind}|${b.col},${b.row}|${b.headline.trim().toLowerCase()}`;
      const byShape = new Map<string, typeof written[number]>();
      for (const w of written) {
        const key = shapeKey(w.block, w.pageIdx);
        if (!byShape.has(key)) byShape.set(key, w);
      }

      const claimed = new Set<string>();
      nextPages.forEach((p, pageIdx) => {
        for (const b of p.blocks) {
          if (b.content.trim()) continue;
          const match = byId.get(b.id) ?? byShape.get(shapeKey(b, pageIdx));
          if (!match || claimed.has(match.block.id)) continue;
          claimed.add(match.block.id);
          b.content = match.block.content;
        }
      });

      /*
       * Refuse a restructure that would throw most of the writing away.
       *
       * Measured in words, not blocks: dropping four empty planned blocks is
       * nothing, dropping the one block holding two thousand words is the
       * document. Over the threshold the builder is asked rather than told —
       * `confirmDiscard` is them saying yes, having been shown the number. The
       * credit isn't spent on a refusal.
       */
      const wordsOf = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
      const totalWords = written.reduce((n, w) => n + wordsOf(w.block.content), 0);
      const keptWords = written.filter((w) => claimed.has(w.block.id)).reduce((n, w) => n + wordsOf(w.block.content), 0);
      const lostWords = totalWords - keptWords;
      if (!confirmDiscard && totalWords >= REPLAN_MIN_WORDS_TO_GUARD && lostWords / totalWords > REPLAN_MAX_DISCARD_FRACTION) {
        return res.status(422).json({
          message: `That restructure drops ${lostWords} of your ${totalWords} written words. Confirm if you want it anyway.`,
          code: "replan_discards_content",
          lostWords, totalWords,
          lostBlocks: written.filter((w) => !claimed.has(w.block.id)).map((w) => ({
            headline: w.block.headline, page: pages[w.pageIdx]?.title ?? `Page ${w.pageIdx + 1}`, words: wordsOf(w.block.content),
          })),
        });
      }

      const updated = await storage.updateDocument(doc.id, {
        pages: nextPages,
        // Taken before the overwrite, so /undo has something to go back to.
        pagesHistory: pushPagesHistory(doc, "replan"),
      } as any);
      // Free: inside a document already paid for.
      await storage.deductCredits(userId, NO_CHARGE);
      res.json({
        document: updated, approach: str(parsed.approach, 1000),
        creditsCharged: 0,
        carriedBlocks: claimed.size, lostWords, totalWords,
        canUndo: true,
      });
    } catch (error) {
      console.error("Document replan error:", error);
      respondToAiError(res, error, "Nova couldn't restructure that document");
    }
  });

  /**
   * How the document actually paginates.
   *
   * The editor counts document pages; the PDF counts printed pages, and a
   * document page whose content overruns silently becomes several. Reporting
   * the real mapping is what lets the editor say "this page spills onto 3"
   * instead of the builder finding out from the download.
   */
  app.get("/api/documents/:docId/layout-report", isAuthenticated, async (req: any, res) => {
    try {
      const doc = await loadDocument(req, res);
      if (!doc) return;
      const project = await storage.getProject(doc.projectId);

      const { totalPdfPages, pageMap } = await renderDocumentPdf({
        title: doc.title,
        pages: (doc.pages as DocumentPage[]) || [],
        settings: coerceSettings(doc.settings),
        projectTitle: project?.title || "",
      });

      res.json({
        totalPdfPages,
        documentPages: pageMap.length,
        pages: pageMap.map((p, i) => ({ index: i, title: p.title, pdfPages: p.pdfPages })),
        overflowing: pageMap.filter((p) => p.pdfPages > 1).length,
      });
    } catch (error) {
      console.error("Layout report error:", error);
      res.status(500).json({ message: "Couldn't measure the document" });
    }
  });

  /**
   * Explicitly cuts overflowing pages down to fit.
   *
   * The fill already does this for its own output; this is for pages the
   * builder has since edited, or a page they want cut harder.
   */
  app.post("/api/documents/:docId/tighten", isAuthenticated, async (req: any, res) => {
    try {
      const doc = await loadDocument(req, res);
      if (!doc) return;
      const userId = (req.user as any).id;

      const ent = await requireFeature(res, userId, "aiMilestones", "The Nova document builder");
      if (!ent) return;

      const { pageIndex } = req.body as { pageIndex?: number };
      const project = await storage.getProject(doc.projectId);
      const settings = coerceSettings(doc.settings);
      const pages = ((doc.pages as DocumentPage[]) || []).map(normalizePage);

      const only = Number.isFinite(Number(pageIndex)) ? [Number(pageIndex)] : undefined;

      const before = await renderDocumentPdf({
        title: doc.title, pages, settings, projectTitle: project?.title || "",
      });
      const overflowing = before.pageMap
        .map((p, i) => (p.pdfPages > 1 && (!only || only.includes(i)) ? i : -1))
        .filter((i) => i >= 0);

      if (!overflowing.length) {
        return res.status(400).json({ message: "Nothing is overflowing — every page already fits." });
      }

      // Free, inside a document already paid for — the whole document was
      // bought at its plan, and tightening it is finishing what was bought.
      if (!(await requireCredits(res, userId, NO_CHARGE, "tightening the document"))) return;

      const result = await tightenPages({
        title: doc.title, pages, settings,
        projectTitle: project?.title || "",
        ent, only, maxPasses: 3,
        knownIds: await collectProjectIds(doc.projectId),
      });

      if (!result.rewritten) {
        return res.status(502).json({
          message: "Nova couldn't shorten that. Try trimming a block by hand.",
          failed: result.failed,
        });
      }

      const updated = await storage.updateDocument(doc.id, { pages: result.pages } as any);
      await storage.deductCredits(userId, NO_CHARGE);

      res.json({
        document: updated,
        blocksRewritten: result.rewritten,
        pagesTightened: overflowing.length,
        passes: result.passes,
        stillOverflowing: result.stillOverflowing,
        totalPdfPages: result.totalPdfPages,
        failed: result.failed,
      });
    } catch (error) {
      console.error("Tighten error:", error);
      respondToAiError(res, error, "Couldn't tighten the document");
    }
  });

  /** The PDF, rendered on demand from the current structure. */
  app.get("/api/documents/:docId/pdf", isAuthenticated, async (req: any, res) => {
    try {
      const doc = await loadDocument(req, res);
      if (!doc) return;
      const project = await storage.getProject(doc.projectId);

      const { buffer: pdf } = await renderDocumentPdf({
        title: doc.title,
        pages: (doc.pages as DocumentPage[]) || [],
        settings: coerceSettings(doc.settings),
        projectTitle: project?.title || "",
      });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `${req.query.download ? "attachment" : "inline"}; filename="${safeFileName(doc.title)}.pdf"`,
      );
      res.send(pdf);
    } catch (error) {
      console.error("Document PDF error:", error);
      res.status(500).json({ message: "Failed to render the PDF" });
    }
  });

  /**
   * Publishes into the Files tab.
   *
   * Writes two things: a PDF in object storage, and a `project_files` row that
   * points back at the document. The row is what makes it visible alongside
   * ordinary uploads; the document stays editable, and re-publishing replaces
   * the PDF rather than piling up copies.
   */
  app.post("/api/documents/:docId/publish", isAuthenticated, rateLimit("workspace"), async (req: any, res) => {
    try {
      const doc = await loadDocument(req, res);
      if (!doc) return;
      const userId = (req.user as any).id;

      const { folder } = req.body as { folder?: string };
      // Folder names are free text so a builder can make their own; kept short
      // and slug-ish so the Files filter stays readable.
      const targetFolder = str(folder, 40).replace(/[^\w \-]/g, "") || "docs";

      const project = await storage.getProject(doc.projectId);
      const pages = (doc.pages as DocumentPage[]) || [];

      const { buffer: pdf } = await renderDocumentPdf({
        title: doc.title,
        pages,
        settings: coerceSettings(doc.settings),
        projectTitle: project?.title || "",
      });

      /*
       * The PDF is private, readable by the project's team.
       *
       * It was written with no ACL policy at all, and `GET /objects/...` only
       * enforces access on objects whose policy says "private" — so a
       * published document was downloadable by anyone holding the URL, with no
       * account and no session. That URL is not a secret: it is stored on a
       * `project_files` row, handed to every team member, and quoted in
       * activity. A business plan, a financial model or a board update on a
       * private project was one copied link away from the open internet.
       *
       * Owner alone isn't enough either: the rest of the team downloads this
       * from the Files tab, so the project's members are named as readers.
       */
      const { ObjectStorageService } = await import("./replit_integrations/object_storage");
      const { ObjectAccessGroupType, ObjectPermission } = await import("./replit_integrations/object_storage/objectAcl");
      const objectPath = await new ObjectStorageService().writeObjectBuffer(pdf, "application/pdf", {
        owner: userId,
        visibility: "private",
        aclRules: [{
          group: { type: ObjectAccessGroupType.PROJECT_MEMBER, id: doc.projectId },
          permission: ObjectPermission.READ,
        }],
      });

      const fileName = `${safeFileName(doc.title)}.pdf`;
      let file;
      if (doc.fileId) {
        // Re-publish: keep the same Files row so links to it stay valid.
        file = await storage.updateProjectFile(doc.fileId, {
          name: fileName, url: objectPath, folder: targetFolder, size: pdf.length,
        }).catch(() => null);
      }
      if (!file) {
        file = await storage.createProjectFile({
          projectId: doc.projectId,
          uploaderId: userId,
          name: fileName,
          url: objectPath,
          folder: targetFolder,
          fileType: "application/pdf",
          size: pdf.length,
        } as any);
      }

      const updated = await storage.updateDocument(doc.id, {
        status: "published", pdfUrl: objectPath, fileId: file.id,
      } as any);

      await storage.logActivity({
        projectId: doc.projectId, userId,
        action: doc.fileId ? "updated a document in Files" : "published a document to Files",
        entityType: "file", entityId: file.id, metadata: { name: fileName, documentId: doc.id },
      }).catch(() => {});

      res.json({ document: updated, file, bytes: pdf.length });
    } catch (error) {
      console.error("Document publish error:", error);
      res.status(500).json({ message: "Failed to publish the document" });
    }
  });

  /**
   * Puts the structure back the way it was before the last re-plan.
   *
   * A restructure is the one action here that can destroy prose, and it is a
   * model call, so "it dropped the section I cared about" is a normal outcome
   * rather than a bug. Without this the only recovery was retyping. The
   * current pages go on the stack on the way past, so undo is itself
   * undoable — pressing it twice returns to where you were, which is what
   * everyone expects from undo and nobody expects from a restore.
   */
  app.post("/api/documents/:docId/undo", isAuthenticated, rateLimit("workspace"), async (req: any, res) => {
    try {
      const doc = await loadDocument(req, res);
      if (!doc) return;
      const history = Array.isArray(doc.pagesHistory) ? (doc.pagesHistory as { at: string; reason: string; pages: unknown }[]) : [];
      const [previous, ...rest] = history;
      if (!previous) return res.status(400).json({ message: "There's nothing to undo on this document.", code: "no_history" });

      const restored = coercePages(previous.pages);
      if (!restored.length) return res.status(400).json({ message: "That earlier version can't be restored.", code: "no_history" });

      const updated = await storage.updateDocument(doc.id, {
        pages: restored,
        pagesHistory: [{ at: new Date().toISOString(), reason: "undo", pages: doc.pages ?? [] }, ...rest].slice(0, PAGES_HISTORY_DEPTH),
      } as any);
      res.json({ document: updated, restoredFrom: previous.at, reason: previous.reason, canUndo: true });
    } catch (error) {
      console.error("Document undo error:", error);
      res.status(500).json({ message: "Couldn't undo that" });
    }
  });

  app.delete("/api/documents/:docId", isAuthenticated, async (req: any, res) => {
    try {
      const doc = await loadDocument(req, res);
      if (!doc) return;

      /*
       * The document's published PDF goes with it.
       *
       * Deleting the document used to delete one row and leave two things
       * standing: the `project_files` entry, which kept the PDF listed in the
       * Files tab pointing at a document that no longer exists, and the stored
       * object itself, still served by `GET /objects/...` to anyone with the
       * link. So "delete this document" removed it from the editor and left
       * the finished, downloadable copy exactly where it was.
       *
       * The object is made unreadable rather than erased: the bytes may still
       * be referenced by an older Files row a member kept, and a dangling ACL
       * on a deleted object costs nothing, while a 404 on someone's live file
       * costs them their file. Both steps are best-effort — the document is
       * going either way, and failing the delete because the bucket hiccuped
       * would leave the builder unable to remove it at all.
       */
      if (doc.fileId) {
        await storage.deleteProjectFile(doc.fileId)
          .catch((err) => console.error(`[documents] couldn't remove the Files row for ${doc.id}:`, err));
      }
      if (doc.pdfUrl?.startsWith("/objects/")) {
        await revokePublishedPdf(doc.pdfUrl, (req.user as any).id)
          .catch((err) => console.error(`[documents] couldn't lock down the PDF for ${doc.id}:`, err));
      }

      await storage.deleteDocument(doc.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Document delete error:", error);
      res.status(500).json({ message: "Failed to delete the document" });
    }
  });
}

// ---------------------------------------------------------------------------

async function isMember(userId: string, projectId: string): Promise<boolean> {
  const project = await storage.getProject(projectId);
  if (!project) return false;
  if (project.ownerId === userId) return true;
  const members = await storage.getProjectMembers(projectId).catch(() => []);
  return members.some((m) => m.userId === userId);
}

/** Loads a document and checks project membership, or responds and returns null. */
async function loadDocument(req: any, res: any) {
  const doc = await storage.getDocument(req.params.docId);
  if (!doc) { res.status(404).json({ message: "Document not found" }); return null; }
  if (!(await isMember((req.user as any).id, doc.projectId))) {
    res.status(403).json({ message: "Unauthorized" });
    return null;
  }
  return doc;
}

/**
 * Makes a published PDF unreadable, for a document that no longer exists.
 *
 * A private policy with nobody on it. The serving route enforces
 * `visibility: "private"`, the owner is deliberately set to a value no account
 * can ever have — an owner always passes the check, so naming the person who
 * pressed delete would leave the file readable by exactly the person who asked
 * for it to be gone. Deleting the bytes would be tidier and is deliberately
 * not what happens: object paths outlive the rows that point at them, and
 * taking away access is reversible in a way that taking away the file is not.
 */
async function revokePublishedPdf(objectPath: string, deletedBy: string): Promise<void> {
  const { ObjectStorageService, setObjectAclPolicy } = await import("./replit_integrations/object_storage");
  const file = await new ObjectStorageService().getObjectEntityFile(objectPath);
  await setObjectAclPolicy(file, { owner: `deleted-document:${deletedBy}`, visibility: "private", aclRules: [] });
}

function safeFileName(title: string): string {
  return (title || "document")
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60) || "document";
}
