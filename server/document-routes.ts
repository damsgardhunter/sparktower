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
import type { Express } from "express";
import OpenAI from "openai";
import { randomUUID } from "crypto";
import { storage } from "./storage";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { requireCredits, requireFeature, modelFor, coachingDirectiveFor } from "./entitlements";
import { CREDIT_COSTS, documentFillCost } from "@shared/plans";
import {
  buildOperableProjectState, stripIdFragments, collectProjectIds,
} from "./project-operations";
import { renderDocumentPdf } from "./document-pdf";
import { parseModelJson } from "./ai-json";
import {
  BLOCK_KINDS, BLOCK_KIND_CONTENT_RULES, DEFAULT_SETTINGS, MAX_GRID_COLUMNS,
  MAX_PAGES, MAX_BLOCKS_PER_PAGE, normalizePage, emptyBlocks, blockWordBudget, pageWordBudget,
  type BlockKind, type DocumentPage, type DocumentSettings, type DocumentBlock,
} from "@shared/documents";

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    const raw = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    const baseURL = raw ? (raw.endsWith("/v1") ? raw : `${raw.replace(/\/$/, "")}/v1`) : undefined;
    _openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY, baseURL });
  }
  return _openai;
}

const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

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

        const parsed = parseJson(completion.choices[0].message.content || "{}");
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

      if (!(await requireCredits(res, userId, CREDIT_COSTS.documentPlan, "a document plan"))) return;

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
        parsed = parseJson(completion.choices[0].message.content || "{}");
      } catch (err) {
        console.error("Document plan parse failed:", err);
        return res.status(502).json({ message: "Nova returned an unreadable plan. Please try again." });
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
        return res.status(502).json({ message: "Nova couldn't work out a structure for that. Try describing the document differently." });
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

      await storage.deductCredits(userId, CREDIT_COSTS.documentPlan);
      res.json({
        document,
        approach: str(parsed.approach, 1000),
        creditsCharged: CREDIT_COSTS.documentPlan,
      });
    } catch (error) {
      console.error("Document plan error:", error);
      res.status(500).json({ message: "Nova couldn't plan that document" });
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
   */
  app.post("/api/documents/:docId/fill", isAuthenticated, async (req: any, res) => {
    try {
      const doc = await loadDocument(req, res);
      if (!doc) return;

      const userId = (req.user as any).id;
      const ent = await requireFeature(res, userId, "aiMilestones", "The Nova document builder");
      if (!ent) return;

      const { blockId, guidance, refill, pageIndex } = req.body as {
        blockId?: string; guidance?: string; refill?: boolean; pageIndex?: number;
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

      const cost = blockId ? CREDIT_COSTS.documentBlockFill : documentFillCost(targets.length);
      if (!(await requireCredits(res, userId, cost, "filling in the document"))) return;

      const project = await storage.getProject(doc.projectId);
      const state = await buildOperableProjectState(doc.projectId, { includeIds: false });
      const knownIds = await collectProjectIds(doc.projectId);

      // Grouped by page: one completion per page keeps each response small
      // enough to come back as valid JSON.
      const byPage = new Map<number, DocumentBlock[]>();
      for (const t of targets) {
        const list = byPage.get(t.pageIndex) || [];
        list.push(t.block);
        byPage.set(t.pageIndex, list);
      }

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

          const parsed = parseJson(completion.choices[0].message.content || "{}");
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

      if (!filled.size) {
        return res.status(502).json({
          message: "Nova couldn't write any of that. Please try again.",
          failedPages,
        });
      }

      // Through normalizePage so per-kind content rules are enforced on the
      // way in — a heading block that came back as three paragraphs becomes
      // one line here rather than rendering as a wall of 15pt text.
      const nextPages = pages.map((page) => normalizePage({
        ...page,
        blocks: page.blocks.map((b) => (filled.has(b.id) ? { ...b, content: filled.get(b.id)! } : b)),
      }));

      /*
       * Verify the fill against the plan before saving.
       *
       * A one-page document that comes back as five printed pages hasn't been
       * filled, it's been overfilled — and the builder asked for a one-pager.
       * The word budgets in the prompt get close but a model still runs over,
       * so this measures the real render and shortens any page that spills.
       * Included in the fill's price: they paid for a document that fits.
       */
      let finalPages = nextPages;
      let tightened = 0;
      let stillOverflowing = 0;
      if (!blockId) {
        const project = await storage.getProject(doc.projectId);
        const result = await tightenPages({
          title: doc.title,
          pages: nextPages,
          settings,
          projectTitle: project?.title || "",
          ent,
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

      const updated = await storage.updateDocument(doc.id, { pages: finalPages } as any);

      /*
       * Charged for what actually landed, not what was attempted. A page whose
       * completion failed shouldn't be billed just because the request was made.
       */
      const actualCost = blockId
        ? CREDIT_COSTS.documentBlockFill
        : documentFillCost(filled.size);
      await storage.deductCredits(userId, actualCost);

      res.json({
        document: updated,
        blocksFilled: filled.size,
        blocksRequested: targets.length,
        blocksTightened: tightened,
        stillOverflowing,
        failedPages,
        // Surfaced so a partial run is visible rather than silent.
        unmatchedIds: unmatched.length,
        creditsCharged: actualCost,
      });
    } catch (error) {
      console.error("Document fill error:", error);
      res.status(500).json({ message: "Nova couldn't fill in the document" });
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

      const { feedback } = req.body as { feedback?: string };
      if (!(await requireCredits(res, userId, CREDIT_COSTS.documentPlan, "a document re-plan"))) return;

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
        parsed = parseJson(completion.choices[0].message.content || "{}");
      } catch {
        return res.status(502).json({ message: "Nova returned an unreadable structure. Please try again." });
      }

      const nextPages = coercePages(parsed.pages);
      if (!nextPages.length) {
        return res.status(502).json({ message: "Nova couldn't restructure that. Try describing what you want differently." });
      }

      // Carry existing content across by id, so a restructure never silently
      // discards prose the builder already has.
      const existingContent = new Map<string, string>();
      for (const p of pages) for (const b of p.blocks) if (b.content.trim()) existingContent.set(b.id, b.content);
      for (const p of nextPages) {
        for (const b of p.blocks) {
          if (!b.content.trim() && existingContent.has(b.id)) b.content = existingContent.get(b.id)!;
        }
      }

      const updated = await storage.updateDocument(doc.id, { pages: nextPages } as any);
      await storage.deductCredits(userId, CREDIT_COSTS.documentPlan);
      res.json({ document: updated, approach: str(parsed.approach, 1000), creditsCharged: CREDIT_COSTS.documentPlan });
    } catch (error) {
      console.error("Document replan error:", error);
      res.status(500).json({ message: "Nova couldn't restructure that document" });
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

      // Priced per overflowing page, once, however many passes it takes.
      const cost = Math.max(1, overflowing.length);
      if (!(await requireCredits(res, userId, cost, "tightening the document"))) return;

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
      await storage.deductCredits(userId, cost);

      res.json({
        document: updated,
        blocksRewritten: result.rewritten,
        pagesTightened: overflowing.length,
        passes: result.passes,
        stillOverflowing: result.stillOverflowing,
        totalPdfPages: result.totalPdfPages,
        failed: result.failed,
        creditsCharged: cost,
      });
    } catch (error) {
      console.error("Tighten error:", error);
      res.status(500).json({ message: "Couldn't tighten the document" });
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
  app.post("/api/documents/:docId/publish", isAuthenticated, async (req: any, res) => {
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

      const { ObjectStorageService } = await import("./replit_integrations/object_storage");
      const objectPath = await new ObjectStorageService().writeObjectBuffer(pdf, "application/pdf");

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

  app.delete("/api/documents/:docId", isAuthenticated, async (req: any, res) => {
    try {
      const doc = await loadDocument(req, res);
      if (!doc) return;
      await storage.deleteDocument(doc.id);
      res.json({ success: true });
    } catch (error) {
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

function safeFileName(title: string): string {
  return (title || "document")
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60) || "document";
}
