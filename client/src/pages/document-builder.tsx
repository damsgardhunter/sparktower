import { useEffect, useMemo, useRef, useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { DocumentBlockCard, BLOCK_DRAG_TYPE } from "@/components/document-block-card";
import {
  Loader2, ArrowLeft, Wand2, Save, FileDown, Upload, Plus, Trash2, Settings2,
  Check, Sparkles, FileText, LayoutTemplate, AlertTriangle, Scissors, RotateCcw,
} from "lucide-react";
import { CREDIT_COSTS } from "@shared/plans";
import {
  DEFAULT_SETTINGS, MAX_GRID_COLUMNS, normalizePage, pageRowCount, emptyBlocks,
  documentWordCount, type DocumentPage, type DocumentSettings, type DocumentBlock,
} from "@shared/documents";
import type { ProjectDocument } from "@shared/schema";

const FOLDER_SUGGESTIONS = ["docs", "specs", "plans", "legal", "design", "research", "general"];

const newBlockId = () =>
  (globalThis.crypto?.randomUUID?.() ?? `b-${Date.now()}-${Math.random().toString(36).slice(2)}`);

export default function DocumentBuilder() {
  const [, params] = useRoute("/projects/:projectId/documents/:docId");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const projectId = params?.projectId;
  const docId = params?.docId;

  /** Local working copy. The server owns the saved state; this owns the edits. */
  const [title, setTitle] = useState("");
  const [pages, setPages] = useState<DocumentPage[]>([]);
  const [settings, setSettings] = useState<DocumentSettings>(DEFAULT_SETTINGS);
  const [pageIndex, setPageIndex] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [dragBlockId, setDragBlockId] = useState<string | null>(null);
  const [dropCell, setDropCell] = useState<{ row: number; col: number } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishFolder, setPublishFolder] = useState("docs");
  const [replanOpen, setReplanOpen] = useState(false);
  const [replanFeedback, setReplanFeedback] = useState("");
  const [fillingBlockId, setFillingBlockId] = useState<string | null>(null);
  const [approach, setApproach] = useState<string | null>(null);
  /** Count of AI writes in flight. Autosave stands down while any are running. */
  const [aiBusy, setAiBusy] = useState(0);
  const hydratedFor = useRef<string | null>(null);

  const { data: doc, isLoading } = useQuery<ProjectDocument>({
    queryKey: ["/api/documents", docId],
    queryFn: async () => {
      const res = await fetch(`/api/documents/${docId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Couldn't load that document");
      return res.json();
    },
    enabled: !!docId,
  });

  /*
   * Hydrate once per document. Re-syncing on every server response would stomp
   * whatever the user is typing the moment an autosave comes back.
   */
  useEffect(() => {
    if (!doc || hydratedFor.current === doc.id) return;
    hydratedFor.current = doc.id;
    setTitle(doc.title);
    setPages(((doc.pages as DocumentPage[]) || []).map(normalizePage));
    setSettings({ ...DEFAULT_SETTINGS, ...(doc.settings as DocumentSettings) });
    setDirty(false);
  }, [doc]);

  const saveMutation = useMutation({
    mutationFn: async (payload: { title?: string; pages?: DocumentPage[]; settings?: DocumentSettings }) => {
      const res = await apiRequest("PATCH", `/api/documents/${docId}`, payload);
      return res.json() as Promise<ProjectDocument>;
    },
    onSuccess: (saved) => {
      setDirty(false);
      // Keep the cache fresh without re-hydrating local state.
      queryClient.setQueryData(["/api/documents", docId], saved);
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "documents"] });
    },
    onError: () => toast({ title: "Couldn't save", description: "Your changes are still here — try again.", variant: "destructive" }),
  });

  /*
   * Debounced autosave. A document editor that loses work because someone
   * navigated away is not one people trust, and an explicit-save-only model
   * guarantees that eventually happens.
   */
  const saveRef = useRef(saveMutation.mutate);
  saveRef.current = saveMutation.mutate;
  /*
   * Autosave is held while an AI write is in flight.
   *
   * A fill can take a couple of minutes, and a debounced save that fires
   * during it PATCHes the pre-fill pages — landing after the fill's own write
   * and replacing the content Nova just produced with empty blocks. The AI
   * mutations own the document while they run.
   */
  useEffect(() => {
    if (!dirty || !docId || aiBusy > 0) return;
    const timer = setTimeout(() => saveRef.current({ title, pages, settings }), 1200);
    return () => clearTimeout(timer);
  }, [dirty, title, pages, settings, docId, aiBusy]);

  // Last-ditch warning for a navigation that beats the autosave.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const mutatePages = (fn: (pages: DocumentPage[]) => DocumentPage[]) => {
    setPages((prev) => fn(prev));
    setDirty(true);
  };

  const updateCurrentPage = (fn: (page: DocumentPage) => DocumentPage) =>
    mutatePages((prev) => prev.map((p, i) => (i === pageIndex ? normalizePage(fn(p)) : p)));

  const page = pages[pageIndex];
  const rowCount = page ? pageRowCount(page) : 0;
  const pending = useMemo(() => emptyBlocks(pages).length, [pages]);
  const wordCount = useMemo(() => documentWordCount(pages), [pages]);

  /**
   * The real pagination. The editor counts document pages; a document page
   * whose content overruns becomes several printed pages, and the builder
   * should see that here rather than in the download.
   */
  const { data: layout, isFetching: layoutFetching } = useQuery<{
    totalPdfPages: number;
    documentPages: number;
    pages: { index: number; title: string; pdfPages: number }[];
    overflowing: number;
  }>({
    queryKey: ["/api/documents", docId, "layout-report", wordCount, pages.length],
    queryFn: async () => {
      const res = await fetch(`/api/documents/${docId}/layout-report`, { credentials: "include" });
      if (!res.ok) throw new Error("no report");
      return res.json();
    },
    // Only meaningful once the server has the current pages.
    enabled: !!docId && !dirty,
  });

  const { data: quote } = useQuery<{ emptyBlocks: number; totalBlocks: number; cost: number }>({
    queryKey: ["/api/documents", docId, "fill-quote", pending],
    queryFn: async () => {
      const res = await fetch(`/api/documents/${docId}/fill-quote`, { credentials: "include" });
      if (!res.ok) throw new Error("no quote");
      return res.json();
    },
    enabled: !!docId,
  });

  const describeError = (err: any, fallback: string) => {
    const raw = err?.message || "";
    const jsonStart = raw.indexOf("{");
    if (jsonStart >= 0) {
      try { return JSON.parse(raw.slice(jsonStart)).message || fallback; } catch { /* keep */ }
    }
    return fallback;
  };

  /** Fills the whole document, or one block when an id is given. */
  const fillMutation = useMutation({
    mutationFn: async (opts: { blockId?: string; refill?: boolean; pageIndex?: number }) => {
      // Save first: the server fills against its own copy, so an unsaved
      // layout change would be filled into the wrong shape.
      if (dirty) await apiRequest("PATCH", `/api/documents/${docId}`, { title, pages, settings });
      const res = await apiRequest("POST", `/api/documents/${docId}/fill`, opts);
      return res.json() as Promise<{
        document: ProjectDocument; blocksFilled: number; blocksRequested: number;
        blocksTightened: number; stillOverflowing: number;
        failedPages: string[]; unmatchedIds: number; creditsCharged: number;
      }>;
    },
    onSuccess: (result) => {
      setPages(((result.document.pages as DocumentPage[]) || []).map(normalizePage));
      setDirty(false);
      queryClient.setQueryData(["/api/documents", docId], result.document);
      queryClient.invalidateQueries({ queryKey: ["/api/subscription"] });
      queryClient.invalidateQueries({ queryKey: ["/api/documents", docId, "layout-report"] });
      const partial = result.blocksFilled < result.blocksRequested;
      toast({
        title: partial
          ? `Wrote ${result.blocksFilled} of ${result.blocksRequested} blocks`
          : `Nova wrote ${result.blocksFilled} block${result.blocksFilled === 1 ? "" : "s"}`,
        description: result.failedPages.length
          // Name the pages that produced nothing, so a partial run points at
          // what to retry instead of reporting a success that didn't happen.
          ? `Nothing came back for: ${result.failedPages.join(", ")}. Use "Fill this page" on those.`
          : result.blocksTightened
            // The fill shortens its own overrun, at no extra cost — say so, or
            // it looks like Nova quietly rewrote things behind their back.
            ? `${result.creditsCharged} credits used. Shortened ${result.blocksTightened} block${result.blocksTightened === 1 ? "" : "s"} to keep the page count you planned.`
            : `${result.creditsCharged} credits used.`,
        variant: result.failedPages.length || partial ? "destructive" : "default",
      });
    },
    onError: (err: any) => toast({
      title: "Nova couldn't write that",
      description: describeError(err, "Try again."),
      variant: "destructive",
    }),
    onMutate: () => setAiBusy((n) => n + 1),
    onSettled: () => { setFillingBlockId(null); setAiBusy((n) => Math.max(0, n - 1)); },
  });

  const replanMutation = useMutation({
    mutationFn: async () => {
      if (dirty) await apiRequest("PATCH", `/api/documents/${docId}`, { title, pages, settings });
      const res = await apiRequest("POST", `/api/documents/${docId}/replan`, { feedback: replanFeedback });
      return res.json() as Promise<{ document: ProjectDocument; approach: string }>;
    },
    onSuccess: (result) => {
      setPages(((result.document.pages as DocumentPage[]) || []).map(normalizePage));
      setPageIndex(0);
      setDirty(false);
      setApproach(result.approach);
      setReplanOpen(false);
      setReplanFeedback("");
      queryClient.setQueryData(["/api/documents", docId], result.document);
      queryClient.invalidateQueries({ queryKey: ["/api/subscription"] });
      toast({ title: "Restructured", description: "Your written content was carried across." });
    },
    onError: (err: any) => toast({ title: "Couldn't restructure", description: describeError(err, "Try again."), variant: "destructive" }),
    onMutate: () => setAiBusy((n) => n + 1),
    onSettled: () => setAiBusy((n) => Math.max(0, n - 1)),
  });

  const tightenMutation = useMutation({
    mutationFn: async (pageIdx?: number) => {
      if (dirty) await apiRequest("PATCH", `/api/documents/${docId}`, { title, pages, settings });
      const res = await apiRequest("POST", `/api/documents/${docId}/tighten`, { pageIndex: pageIdx });
      return res.json() as Promise<{
        document: ProjectDocument; blocksRewritten: number; pagesTightened: number;
        stillOverflowing: number; totalPdfPages: number; creditsCharged: number;
      }>;
    },
    onSuccess: (result) => {
      setPages(((result.document.pages as DocumentPage[]) || []).map(normalizePage));
      setDirty(false);
      queryClient.setQueryData(["/api/documents", docId], result.document);
      queryClient.invalidateQueries({ queryKey: ["/api/documents", docId, "layout-report"] });
      queryClient.invalidateQueries({ queryKey: ["/api/subscription"] });
      toast({
        title: `Tightened ${result.pagesTightened} page${result.pagesTightened === 1 ? "" : "s"}`,
        description: result.stillOverflowing
          ? `${result.stillOverflowing} page${result.stillOverflowing === 1 ? " still overflows" : "s still overflow"} — run it again or cut a block.`
          : `Now ${result.totalPdfPages} printed page${result.totalPdfPages === 1 ? "" : "s"}, nothing overflowing.`,
      });
    },
    onError: (err: any) => toast({ title: "Couldn't tighten it", description: describeError(err, "Try again."), variant: "destructive" }),
    onMutate: () => setAiBusy((n) => n + 1),
    onSettled: () => setAiBusy((n) => Math.max(0, n - 1)),
  });

  const publishMutation = useMutation({
    mutationFn: async () => {
      if (dirty) await apiRequest("PATCH", `/api/documents/${docId}`, { title, pages, settings });
      const res = await apiRequest("POST", `/api/documents/${docId}/publish`, { folder: publishFolder });
      return res.json() as Promise<{ document: ProjectDocument; file: { name: string; folder: string }; bytes: number }>;
    },
    onSuccess: (result) => {
      setDirty(false);
      setPublishOpen(false);
      queryClient.setQueryData(["/api/documents", docId], result.document);
      for (const key of ["files", "documents", "activity"]) {
        queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, key] });
      }
      toast({
        title: "Saved to Files",
        description: `${result.file.name} in "${result.file.folder}" · ${(result.bytes / 1024).toFixed(0)} KB`,
      });
    },
    onError: (err: any) => toast({ title: "Couldn't publish", description: describeError(err, "Try again."), variant: "destructive" }),
  });

  // --- Grid editing -------------------------------------------------------

  const moveBlock = (blockId: string, row: number, col: number) => {
    updateCurrentPage((p) => ({
      ...p,
      blocks: p.blocks.map((b) => (b.id === blockId ? { ...b, row, col } : b)),
    }));
  };

  const changeBlock = (blockId: string, patch: Partial<DocumentBlock>) => {
    updateCurrentPage((p) => ({
      ...p,
      blocks: p.blocks.map((b) => (b.id === blockId ? { ...b, ...patch } : b)),
    }));
  };

  const addBlock = () => {
    const id = newBlockId();
    updateCurrentPage((p) => ({
      ...p,
      blocks: [...p.blocks, {
        id, kind: "text", headline: "New block", intent: "",
        content: "", col: 0, row: pageRowCount(p), colSpan: p.columns, rowSpan: 1,
      }],
    }));
    setSelectedBlockId(id);
  };

  const addPage = (asChapter = false) => {
    const id = newBlockId();
    mutatePages((prev) => [
      ...prev,
      normalizePage({
        id: newBlockId(),
        title: asChapter ? "New chapter" : `Page ${prev.length + 1}`,
        purpose: "",
        columns: 1,
        isChapterPage: asChapter,
        blocks: asChapter ? [] : [{
          id, kind: "heading", headline: "Section heading", intent: "",
          content: "", col: 0, row: 0, colSpan: 1, rowSpan: 1,
        }],
      }),
    ]);
    setPageIndex(pages.length);
  };

  const deletePage = (index: number) => {
    if (pages.length <= 1) {
      toast({ title: "A document needs at least one page" });
      return;
    }
    mutatePages((prev) => prev.filter((_, i) => i !== index));
    setPageIndex((i) => Math.max(0, Math.min(i, pages.length - 2)));
  };

  if (isLoading) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }
  if (!doc) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-secondary">That document doesn't exist.</p>
        <Button variant="outline" onClick={() => setLocation(`/projects/${projectId}/manage`)}>Back to project</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* --- Toolbar --- */}
      <div className="border-b border-border bg-background/95 backdrop-blur sticky top-0 z-20">
        <div className="flex items-center gap-2 p-3 flex-wrap">
          <Button
            variant="ghost" size="icon" className="shrink-0"
            onClick={() => setLocation(`/projects/${projectId}/manage`)}
            data-testid="button-doc-back"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>

          <Input
            value={title}
            onChange={(e) => { setTitle(e.target.value); setDirty(true); }}
            className="max-w-md h-9 font-semibold border-transparent hover:border-border focus:border-border"
            data-testid="input-doc-title"
          />

          <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
            {saveMutation.isPending ? (
              <><Loader2 className="h-3 w-3 animate-spin" /> Saving…</>
            ) : dirty ? (
              <><span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Unsaved</>
            ) : (
              <><Check className="h-3 w-3 text-emerald-500" /> Saved</>
            )}
          </div>

          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <Badge variant="secondary" className="text-[10px]" data-testid="badge-doc-stats">
              {pages.length} page{pages.length === 1 ? "" : "s"}
              {layout && layout.totalPdfPages !== pages.length && (
                <span className="text-amber-600 dark:text-amber-400">
                  {" "}→ {layout.totalPdfPages} printed
                </span>
              )}
              {" "}· {wordCount} words
            </Badge>

            <Button
              variant="outline" size="sm" className="gap-1.5"
              onClick={() => setShowSettings((s) => !s)}
              data-testid="button-doc-settings"
            >
              <Settings2 className="h-3.5 w-3.5" /> Layout
            </Button>

            <Button
              variant="outline" size="sm" className="gap-1.5"
              disabled={replanMutation.isPending}
              onClick={() => setReplanOpen(true)}
              data-testid="button-doc-replan"
            >
              <LayoutTemplate className="h-3.5 w-3.5" /> Restructure ({CREDIT_COSTS.documentPlan})
            </Button>

            {/* When nothing is empty the action becomes a rewrite rather than a
                disabled dead end — "All blocks filled" with nothing to click
                left builders stuck if a page hadn't really been written. */}
            {pending > 0 ? (
              <Button
                size="sm" className="gap-1.5"
                disabled={fillMutation.isPending}
                onClick={() => fillMutation.mutate({})}
                data-testid="button-doc-fill"
              >
                {fillMutation.isPending && !fillingBlockId
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Nova is writing…</>
                  : <><Wand2 className="h-3.5 w-3.5" /> Fill {pending} empty block{pending === 1 ? "" : "s"} ({quote?.cost ?? pending})</>}
              </Button>
            ) : (
              <Button
                size="sm" variant="outline" className="gap-1.5"
                disabled={fillMutation.isPending}
                onClick={() => fillMutation.mutate({ refill: true })}
                title="Every block has content — this rewrites them all from scratch"
                data-testid="button-doc-refill"
              >
                {fillMutation.isPending && !fillingBlockId
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Nova is rewriting…</>
                  : <><RotateCcw className="h-3.5 w-3.5" /> Rewrite all ({quote?.totalBlocks ?? 0})</>}
              </Button>
            )}

            <Button
              variant="outline" size="sm" className="gap-1.5"
              onClick={() => window.open(`/api/documents/${docId}/pdf`, "_blank")}
              data-testid="button-doc-pdf"
            >
              <FileDown className="h-3.5 w-3.5" /> PDF
            </Button>

            <Button
              variant="outline" size="sm" className="gap-1.5"
              disabled={publishMutation.isPending}
              onClick={() => setPublishOpen(true)}
              data-testid="button-doc-publish"
            >
              <Upload className="h-3.5 w-3.5" /> Save to Files
            </Button>
          </div>
        </div>

        {/* --- Document-wide settings --- */}
        {showSettings && (
          <div className="border-t border-border/60 bg-muted/20 p-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <Label className="text-xs">Subtitle</Label>
              <Input
                value={settings.subtitle}
                onChange={(e) => { setSettings((s) => ({ ...s, subtitle: e.target.value })); setDirty(true); }}
                className="h-8 text-xs" data-testid="input-doc-subtitle"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Running header</Label>
              <Input
                value={settings.header}
                onChange={(e) => { setSettings((s) => ({ ...s, header: e.target.value })); setDirty(true); }}
                placeholder="Top of every page"
                className="h-8 text-xs" data-testid="input-doc-header"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Footer</Label>
              <Input
                value={settings.footer}
                onChange={(e) => { setSettings((s) => ({ ...s, footer: e.target.value })); setDirty(true); }}
                placeholder="Bottom of every page"
                className="h-8 text-xs" data-testid="input-doc-footer"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs">Title page</Label>
                <Switch
                  checked={settings.titlePage}
                  onCheckedChange={(v) => { setSettings((s) => ({ ...s, titlePage: v })); setDirty(true); }}
                  data-testid="switch-doc-titlepage"
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs">Page numbers</Label>
                <Switch
                  checked={settings.showPageNumbers}
                  onCheckedChange={(v) => { setSettings((s) => ({ ...s, showPageNumbers: v })); setDirty(true); }}
                  data-testid="switch-doc-pagenumbers"
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs">Accent</Label>
                <input
                  type="color"
                  value={settings.accentColor}
                  onChange={(e) => { setSettings((s) => ({ ...s, accentColor: e.target.value })); setDirty(true); }}
                  className="h-6 w-10 rounded border border-border bg-transparent"
                  data-testid="input-doc-accent"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Overflow is the thing that surprises people: the editor says one page,
          the PDF is five. Say it here, and offer the fix. */}
      {layout && layout.overflowing > 0 && (
        <div className="flex items-start justify-between gap-3 border-b border-amber-500/40 bg-amber-500/10 p-3" data-testid="banner-overflow">
          <div className="flex items-start gap-2 min-w-0">
            <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
            <div className="min-w-0 text-sm">
              <p className="font-medium">
                {layout.overflowing === 1
                  ? "One page has more content than fits on it"
                  : `${layout.overflowing} pages have more content than fits on them`}
              </p>
              <p className="text-xs text-muted-foreground">
                This document is {pages.length} page{pages.length === 1 ? "" : "s"} in the editor but prints
                as {layout.totalPdfPages}. Nova can cut the long pages down to fit, or you can trim a block yourself.
              </p>
            </div>
          </div>
          <Button
            size="sm" className="gap-1.5 shrink-0"
            disabled={tightenMutation.isPending}
            onClick={() => tightenMutation.mutate(undefined)}
            data-testid="button-tighten-all"
          >
            {tightenMutation.isPending
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Cutting…</>
              : <><Scissors className="h-3.5 w-3.5" /> Tighten to fit</>}
          </Button>
        </div>
      )}

      {approach && (
        <div className="flex items-start justify-between gap-3 border-b border-border/60 bg-primary/5 p-3">
          <div className="flex items-start gap-2 min-w-0">
            <Sparkles className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <p className="text-sm text-secondary leading-relaxed">{approach}</p>
          </div>
          <Button variant="ghost" size="sm" className="h-6 px-2 shrink-0" onClick={() => setApproach(null)}>Dismiss</Button>
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        {/* --- Page list --- */}
        <aside className="w-56 border-r border-border shrink-0 flex flex-col">
          <div className="p-2 border-b border-border/60">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-1">Pages</p>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
            {pages.map((p, i) => (
              <button
                key={p.id}
                type="button"
                onClick={() => { setPageIndex(i); setSelectedBlockId(null); }}
                className={`w-full text-left rounded-md p-2 text-xs transition-colors ${
                  i === pageIndex ? "bg-primary/10 border border-primary/40" : "hover:bg-muted border border-transparent"
                }`}
                data-testid={`page-tab-${i}`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">{i + 1}</span>
                  {p.isChapterPage && <Badge variant="outline" className="text-[8px] px-1 py-0">chapter</Badge>}
                  <span className="font-medium truncate">{p.title || "Untitled"}</span>
                </div>
                {p.purpose && <p className="text-[10px] text-muted-foreground line-clamp-2 mt-0.5">{p.purpose}</p>}
                <p className="text-[9px] text-muted-foreground mt-0.5">
                  {p.blocks.filter((b) => b.kind !== "spacer").length} blocks ·{" "}
                  {p.blocks.filter((b) => b.content.trim()).length} written
                  {!p.isChapterPage && p.blocks.some((b) => b.kind !== "spacer" && !b.content.trim()) && (
                    <span className="text-amber-600 dark:text-amber-400"> · unwritten</span>
                  )}
                  {(() => {
                    const printed = layout?.pages.find((lp) => lp.index === i)?.pdfPages ?? 1;
                    return printed > 1
                      ? <span className="text-amber-600 dark:text-amber-400"> · prints as {printed}</span>
                      : null;
                  })()}
                </p>
              </button>
            ))}
          </div>
          <div className="p-2 border-t border-border/60 space-y-1">
            <Button variant="outline" size="sm" className="w-full gap-1.5 text-xs" onClick={() => addPage(false)} data-testid="button-add-page">
              <Plus className="h-3 w-3" /> Add page
            </Button>
            <Button variant="ghost" size="sm" className="w-full gap-1.5 text-xs" onClick={() => addPage(true)} data-testid="button-add-chapter">
              <Plus className="h-3 w-3" /> Add chapter divider
            </Button>
          </div>
        </aside>

        {/* --- The page canvas --- */}
        <main className="flex-1 min-w-0 overflow-y-auto bg-muted/20 p-6">
          {!page ? (
            <p className="text-sm text-muted-foreground">This document has no pages.</p>
          ) : (
            <div className="mx-auto max-w-4xl space-y-4">
              {/* Page header controls, mirroring what the PDF prints. */}
              <div className="flex items-end gap-2 flex-wrap">
                <div className="flex-1 min-w-[12rem] space-y-1">
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Page title</Label>
                  <Input
                    value={page.title}
                    onChange={(e) => updateCurrentPage((p) => ({ ...p, title: e.target.value }))}
                    className="h-9 font-semibold" data-testid="input-page-title"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Columns</Label>
                  <Select
                    value={String(page.columns)}
                    onValueChange={(v) => updateCurrentPage((p) => ({ ...p, columns: Number(v) }))}
                  >
                    <SelectTrigger className="h-9 w-24 text-xs" data-testid="select-page-columns"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: MAX_GRID_COLUMNS }, (_, i) => i + 1).map((n) => (
                        <SelectItem key={n} value={String(n)}>{n} column{n === 1 ? "" : "s"}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={addBlock} data-testid="button-add-block">
                  <Plus className="h-3.5 w-3.5" /> Block
                </Button>
                {/* Per-page, so a page the whole-document run skipped can always
                    be written on its own. */}
                {(() => {
                  const pageEmpty = page.blocks.filter((b) => b.kind !== "spacer" && !b.content.trim()).length;
                  return (
                    <Button
                      variant={pageEmpty > 0 ? "default" : "outline"}
                      size="sm" className="h-9 gap-1.5"
                      disabled={fillMutation.isPending || page.isChapterPage}
                      onClick={() => fillMutation.mutate({ pageIndex, refill: pageEmpty === 0 })}
                      data-testid="button-fill-page"
                    >
                      {fillMutation.isPending && !fillingBlockId
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <Wand2 className="h-3.5 w-3.5" />}
                      {pageEmpty > 0 ? `Fill this page (${pageEmpty})` : "Rewrite this page"}
                    </Button>
                  );
                })()}
                {(layout?.pages.find((lp) => lp.index === pageIndex)?.pdfPages ?? 1) > 1 && (
                  <Button
                    variant="outline" size="sm" className="h-9 gap-1.5 border-amber-500/50 text-amber-600 dark:text-amber-400"
                    disabled={tightenMutation.isPending}
                    onClick={() => tightenMutation.mutate(pageIndex)}
                    data-testid="button-tighten-page"
                  >
                    {tightenMutation.isPending
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Scissors className="h-3.5 w-3.5" />}
                    Tighten this page
                  </Button>
                )}
                <Button
                  variant="ghost" size="sm" className="h-9 gap-1.5 text-destructive"
                  onClick={() => deletePage(pageIndex)}
                  data-testid="button-delete-page"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Page
                </Button>
              </div>

              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  What this page is for — Nova uses this when writing
                </Label>
                <Textarea
                  value={page.purpose}
                  onChange={(e) => updateCurrentPage((p) => ({ ...p, purpose: e.target.value }))}
                  className="min-h-[52px] text-xs" data-testid="textarea-page-purpose"
                />
              </div>

              {page.isChapterPage ? (
                <div className="rounded-lg border border-dashed border-border bg-card p-12 text-center">
                  <FileText className="h-8 w-8 mx-auto mb-2 text-muted-foreground opacity-50" />
                  <p className="text-sm font-medium">Chapter divider</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Prints as a full page with just the chapter title. No blocks.
                  </p>
                </div>
              ) : (
                <>
                  {/* The grid. Drop cells sit under the blocks and only accept
                      events while a block is actually being dragged. */}
                  <div
                    className="relative rounded-lg border border-border bg-card p-4 shadow-sm"
                    style={{ borderTopColor: settings.accentColor, borderTopWidth: 3 }}
                  >
                    {settings.header && (
                      <p className="text-[10px] text-muted-foreground mb-2 pb-2 border-b border-border/50">{settings.header}</p>
                    )}
                    <div
                      className="grid gap-3"
                      style={{
                        gridTemplateColumns: `repeat(${page.columns}, minmax(0, 1fr))`,
                        gridAutoRows: "minmax(5.5rem, auto)",
                      }}
                    >
                      {/* Drop targets: every cell, plus one spare row to append into. */}
                      {dragBlockId && Array.from({ length: rowCount + 1 }, (_, r) =>
                        Array.from({ length: page.columns }, (_, c) => (
                          <div
                            key={`cell-${r}-${c}`}
                            style={{ gridColumn: c + 1, gridRow: r + 1 }}
                            className={`rounded-md border-2 border-dashed transition-colors z-10 ${
                              dropCell?.row === r && dropCell?.col === c
                                ? "border-primary bg-primary/10"
                                : "border-border/40"
                            }`}
                            onDragOver={(e) => {
                              if (!e.dataTransfer.types.includes(BLOCK_DRAG_TYPE)) return;
                              e.preventDefault();
                              e.dataTransfer.dropEffect = "move";
                              if (dropCell?.row !== r || dropCell?.col !== c) setDropCell({ row: r, col: c });
                            }}
                            onDrop={(e) => {
                              const id = e.dataTransfer.getData(BLOCK_DRAG_TYPE);
                              e.preventDefault();
                              setDropCell(null);
                              setDragBlockId(null);
                              if (id) moveBlock(id, r, c);
                            }}
                            data-testid={`drop-cell-${r}-${c}`}
                          />
                        )),
                      )}

                      {page.blocks.map((block) => (
                        <DocumentBlockCard
                          key={block.id}
                          block={block}
                          columns={page.columns}
                          accent={settings.accentColor}
                          isDragging={dragBlockId === block.id}
                          filling={fillMutation.isPending && fillingBlockId === block.id}
                          isSelected={selectedBlockId === block.id}
                          onSelect={() => setSelectedBlockId(block.id)}
                          onDragStart={(e) => {
                            e.dataTransfer.setData(BLOCK_DRAG_TYPE, block.id);
                            e.dataTransfer.effectAllowed = "move";
                            setDragBlockId(block.id);
                          }}
                          onDragEnd={() => { setDragBlockId(null); setDropCell(null); }}
                          onChange={(patch) => changeBlock(block.id, patch)}
                          onDelete={() => updateCurrentPage((p) => ({ ...p, blocks: p.blocks.filter((b) => b.id !== block.id) }))}
                          onFill={() => { setFillingBlockId(block.id); fillMutation.mutate({ blockId: block.id }); }}
                        />
                      ))}
                    </div>
                    {(settings.footer || settings.showPageNumbers) && (
                      <p className="text-[10px] text-muted-foreground text-center mt-3 pt-2 border-t border-border/50">
                        {[settings.footer, settings.showPageNumbers ? `${pageIndex + 1} / ${pages.length}` : null]
                          .filter(Boolean).join("   ·   ")}
                      </p>
                    )}
                  </div>

                  {/* The selected block's plan, editable — this is what Nova
                      writes against, so it has to be changeable by hand. */}
                  {selectedBlockId && (() => {
                    const selected = page.blocks.find((b) => b.id === selectedBlockId);
                    if (!selected) return null;
                    return (
                      <div className="rounded-lg border border-border bg-card p-3 space-y-2" data-testid="panel-block-plan">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            Block plan — Nova writes to this
                          </p>
                          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setSelectedBlockId(null)}>Close</Button>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Headline</Label>
                          <Input
                            value={selected.headline}
                            onChange={(e) => changeBlock(selected.id, { headline: e.target.value })}
                            className="h-8 text-xs" data-testid="input-block-headline"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">What goes in it</Label>
                          <Textarea
                            value={selected.intent}
                            onChange={(e) => changeBlock(selected.id, { intent: e.target.value })}
                            placeholder="Be specific — this is the instruction Nova writes from."
                            className="min-h-[60px] text-xs" data-testid="textarea-block-intent"
                          />
                        </div>
                      </div>
                    );
                  })()}
                </>
              )}
            </div>
          )}
        </main>
      </div>

      {/* --- Restructure --- */}
      <Dialog open={replanOpen} onOpenChange={setReplanOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LayoutTemplate className="h-4 w-4 text-primary" /> Restructure this document
            </DialogTitle>
            <DialogDescription>
              Nova re-plans the pages and the grid. Blocks you've already written keep their
              content — it's the shape that changes.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-1">
            <Label className="text-xs">What's wrong with the current shape?</Label>
            <Textarea
              value={replanFeedback}
              onChange={(e) => setReplanFeedback(e.target.value)}
              placeholder="e.g. Too many pages — get it down to two. And put the metrics beside the loop steps, not below them."
              className="min-h-[90px]"
              data-testid="textarea-replan-feedback"
            />
            {wordCount > 0 && (
              <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-500" />
                You have {wordCount} words written. Content moves with its block, but a block
                Nova drops takes its text with it.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReplanOpen(false)}>Cancel</Button>
            <Button
              disabled={replanMutation.isPending}
              onClick={() => replanMutation.mutate()}
              data-testid="button-confirm-replan"
            >
              {replanMutation.isPending
                ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Restructuring…</>
                : `Restructure (${CREDIT_COSTS.documentPlan})`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --- Publish --- */}
      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-4 w-4 text-primary" /> Save to Files
            </DialogTitle>
            <DialogDescription>
              Renders a PDF and puts it in the project's Files tab. The document stays editable
              here, and saving again replaces the PDF rather than adding another copy.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label className="text-xs">Folder</Label>
              <Input
                value={publishFolder}
                onChange={(e) => setPublishFolder(e.target.value)}
                placeholder="docs"
                data-testid="input-publish-folder"
              />
              <div className="flex flex-wrap gap-1 pt-0.5">
                {FOLDER_SUGGESTIONS.map((f) => (
                  <Button
                    key={f} variant={publishFolder === f ? "default" : "outline"}
                    size="sm" className="h-6 text-[11px] px-2"
                    onClick={() => setPublishFolder(f)}
                    data-testid={`folder-${f}`}
                  >
                    {f}
                  </Button>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground">
                Type anything to make a new folder.
              </p>
            </div>
            {pending > 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                {pending} block{pending === 1 ? " is" : "s are"} still empty and will print blank.
              </p>
            )}
            {layout && (
              <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                <FileDown className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                The PDF will be {layout.totalPdfPages} page{layout.totalPdfPages === 1 ? "" : "s"}
                {layout.overflowing > 0 && " — some pages overflow. Tighten first if that matters."}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPublishOpen(false)}>Cancel</Button>
            <Button
              disabled={publishMutation.isPending || !publishFolder.trim()}
              onClick={() => publishMutation.mutate()}
              data-testid="button-confirm-publish"
            >
              {publishMutation.isPending
                ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Rendering…</>
                : <><Save className="h-4 w-4 mr-2" /> Save PDF to Files</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
