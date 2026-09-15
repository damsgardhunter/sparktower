/**
 * A Nova document — the web's /projects/:projectId/documents/:docId
 * (client/src/pages/document-builder.tsx), on the phone.
 *
 * A document is pages; a page is a grid of blocks, each with Nova's one-line
 * plan (headline + what goes in it) and its content. The web lays the grid
 * out and drags blocks between cells; a phone stacks each page's blocks in
 * reading order and keeps everything else: autosave, Nova writing one block,
 * one page or the lot, restructuring, tightening overflowing pages, layout
 * settings, and saving the rendered PDF into the project's Files.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Linking, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../../src/api/client";
import { colors, font, fontFamily, radius, shadow, spacing } from "../../../../src/theme";
import { Btn, Cost, Empty, Icon, IconButton, Loading, Meta, Row, assetUri, errText } from "../../../../src/components/ui";
import { Sheet } from "../../../../src/components/Sheet";
import { Bubble, NoticeProvider, Overline, Tag, useNotify } from "../../../../src/components/manage/bits";

// --- The document model (shared/documents.ts), restated -------------------------

const BLOCK_KINDS = ["heading", "text", "bullets", "numbered", "table", "callout", "metrics", "quote", "spacer"] as const;
type BlockKind = (typeof BLOCK_KINDS)[number];
const BLOCK_KIND_LABELS: Record<BlockKind, string> = {
  heading: "Heading", text: "Paragraphs", bullets: "Bullet list", numbered: "Numbered list", table: "Table",
  callout: "Callout", metrics: "Metrics row", quote: "Pull quote", spacer: "Spacer",
};
const MAX_GRID_COLUMNS = 4;
const DOCUMENT_PLAN_COST = 5;
const FOLDER_SUGGESTIONS = ["docs", "specs", "plans", "legal", "design", "research", "general"];
const ACCENTS = ["#6366f1", "#9745B5", "#0284C7", "#059669", "#D97706", "#E11D48", "#111827"];

interface DocumentBlock { id: string; kind: BlockKind; headline: string; intent: string; content: string; col: number; row: number; colSpan: number; rowSpan: number }
interface DocumentPage { id: string; title: string; purpose: string; columns: number; isChapterPage?: boolean; blocks: DocumentBlock[] }
interface DocumentSettings { header: string; footer: string; showPageNumbers: boolean; titlePage: boolean; subtitle: string; accentColor: string }
interface ProjectDocument { id: string; projectId: string; title: string; pages: DocumentPage[]; settings: Partial<DocumentSettings> }
interface Layout { totalPdfPages: number; documentPages: number; pages: { index: number; title: string; pdfPages: number }[]; overflowing: number }

const DEFAULT_SETTINGS: DocumentSettings = { header: "", footer: "", showPageNumbers: true, titlePage: false, subtitle: "", accentColor: "#6366f1" };
const newId = () => (globalThis.crypto?.randomUUID?.() ?? `b-${Date.now()}-${Math.random().toString(36).slice(2)}`);
const rowCount = (p: DocumentPage) => p.blocks.reduce((m, b) => Math.max(m, (b.row ?? 0) + (b.rowSpan ?? 1)), 0);
const ordered = (p: DocumentPage) => [...p.blocks].sort((a, b) => a.row - b.row || a.col - b.col);
const emptyCount = (pages: DocumentPage[]) => pages.reduce((n, p) => n + p.blocks.filter((b) => b.kind !== "spacer" && !b.content.trim()).length, 0);
const wordCount = (pages: DocumentPage[]) => pages.reduce((n, p) => n + p.blocks.reduce((m, b) => m + (b.content.trim() ? b.content.trim().split(/\s+/).length : 0), 0), 0);
const hydrate = (d: ProjectDocument) => ({ title: d.title, pages: (d.pages || []).map((p) => ({ ...p, blocks: p.blocks || [] })), settings: { ...DEFAULT_SETTINGS, ...(d.settings || {}) } });

export default function DocumentScreen() {
  return (
    <NoticeProvider>
      <DocumentBuilder />
    </NoticeProvider>
  );
}

function DocumentBuilder() {
  const { id: projectId, docId } = useLocalSearchParams<{ id: string; docId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { notify, fail } = useNotify();

  const [title, setTitle] = useState("");
  const [pages, setPages] = useState<DocumentPage[]>([]);
  const [settings, setSettings] = useState<DocumentSettings>(DEFAULT_SETTINGS);
  const [pageIndex, setPageIndex] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [aiBusy, setAiBusy] = useState(0);
  const [openBlock, setOpenBlock] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [fillingBlock, setFillingBlock] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"layout" | "replan" | "publish" | null>(null);
  const [replanFeedback, setReplanFeedback] = useState("");
  const [folder, setFolder] = useState("docs");
  const [approach, setApproach] = useState<string | null>(null);
  const [savedFile, setSavedFile] = useState<{ name: string; folder: string; url?: string } | null>(null);
  const hydratedFor = useRef<string | null>(null);

  const docKey = ["document", docId];
  const { data: doc, isLoading, error } = useQuery({
    queryKey: docKey,
    queryFn: () => api<ProjectDocument>(`/api/documents/${docId}`),
    enabled: !!docId,
    retry: false,
  });

  // Hydrate once per document, so an autosave coming back never stomps typing.
  useEffect(() => {
    if (!doc || hydratedFor.current === doc.id) return;
    hydratedFor.current = doc.id;
    const h = hydrate(doc);
    setTitle(h.title); setPages(h.pages); setSettings(h.settings); setDirty(false);
  }, [doc]);

  const invalidateLists = () => {
    for (const key of ["documents", "files", "activity"]) qc.invalidateQueries({ queryKey: ["manage", projectId, key] });
  };
  const applyServer = (d: ProjectDocument) => {
    const h = hydrate(d);
    setPages(h.pages); setDirty(false);
    qc.setQueryData(docKey, d);
    qc.invalidateQueries({ queryKey: ["document", docId, "layout"] });
    qc.invalidateQueries({ queryKey: ["subscription"] });
  };

  const save = useMutation({
    mutationFn: (payload: { title: string; pages: DocumentPage[]; settings: DocumentSettings }) => api<ProjectDocument>(`/api/documents/${docId}`, { method: "PATCH", body: payload }),
    onSuccess: (saved) => { setDirty(false); qc.setQueryData(docKey, saved); invalidateLists(); },
    onError: (e) => fail(e, "Couldn't save — your changes are still here."),
  });
  const saveRef = useRef(save.mutate);
  saveRef.current = save.mutate;
  // Debounced autosave, held while Nova is writing so a stale save can't overwrite the fill.
  useEffect(() => {
    if (!dirty || !docId || aiBusy > 0) return;
    const t = setTimeout(() => saveRef.current({ title, pages, settings }), 1200);
    return () => clearTimeout(t);
  }, [dirty, title, pages, settings, docId, aiBusy]);

  const pending = useMemo(() => emptyCount(pages), [pages]);
  const words = useMemo(() => wordCount(pages), [pages]);

  const { data: layout } = useQuery({
    queryKey: ["document", docId, "layout", words, pages.length],
    queryFn: () => api<Layout>(`/api/documents/${docId}/layout-report`),
    enabled: !!docId && !dirty && !!doc,
    retry: false,
  });
  const { data: quote } = useQuery({
    queryKey: ["document", docId, "quote", pending],
    queryFn: () => api<{ emptyBlocks: number; totalBlocks: number; cost: number }>(`/api/documents/${docId}/fill-quote`),
    enabled: !!docId && !!doc,
    retry: false,
  });

  /** The AI routes work on the server's copy, so save first. */
  const flush = async () => { if (dirty) await api(`/api/documents/${docId}`, { method: "PATCH", body: { title, pages, settings } }); };
  const busy = { onMutate: () => setAiBusy((n) => n + 1), onSettled: () => setAiBusy((n) => Math.max(0, n - 1)) };

  const fill = useMutation({
    mutationFn: async (opts: { blockId?: string; refill?: boolean; pageIndex?: number }) => {
      await flush();
      return api<{ document: ProjectDocument; blocksFilled: number; blocksRequested: number; blocksTightened: number; failedPages: string[]; creditsCharged: number }>(`/api/documents/${docId}/fill`, { method: "POST", body: opts });
    },
    onSuccess: (r) => {
      applyServer(r.document);
      const partial = r.blocksFilled < r.blocksRequested;
      notify(
        r.failedPages.length ? `Nothing came back for: ${r.failedPages.join(", ")}. Fill those pages on their own.`
          : `${partial ? `Wrote ${r.blocksFilled} of ${r.blocksRequested} blocks` : `Nova wrote ${r.blocksFilled} block${r.blocksFilled === 1 ? "" : "s"}`} · ${r.creditsCharged} credits${r.blocksTightened ? ` · shortened ${r.blocksTightened} to fit` : ""}`,
        r.failedPages.length || partial ? "error" : "success",
      );
    },
    onError: (e) => fail(e, "Nova couldn't write that"),
    onMutate: busy.onMutate,
    onSettled: () => { setFillingBlock(null); busy.onSettled(); },
  });
  const replan = useMutation({
    mutationFn: async () => { await flush(); return api<{ document: ProjectDocument; approach: string }>(`/api/documents/${docId}/replan`, { method: "POST", body: { feedback: replanFeedback } }); },
    onSuccess: (r) => { applyServer(r.document); setPageIndex(0); setApproach(r.approach); setSheet(null); setReplanFeedback(""); notify("Restructured — your written content was carried across"); },
    onError: (e) => fail(e, "Couldn't restructure"),
    ...busy,
  });
  const tighten = useMutation({
    mutationFn: async (idx?: number) => { await flush(); return api<{ document: ProjectDocument; pagesTightened: number; stillOverflowing: number; totalPdfPages: number }>(`/api/documents/${docId}/tighten`, { method: "POST", body: { pageIndex: idx } }); },
    onSuccess: (r) => {
      applyServer(r.document);
      notify(`Tightened ${r.pagesTightened} page${r.pagesTightened === 1 ? "" : "s"} · ${r.stillOverflowing ? `${r.stillOverflowing} still overflow` : `now ${r.totalPdfPages} printed page${r.totalPdfPages === 1 ? "" : "s"}`}`);
    },
    onError: (e) => fail(e, "Couldn't tighten it"),
    ...busy,
  });
  const publish = useMutation({
    mutationFn: async () => { await flush(); return api<{ document: ProjectDocument; file: { name: string; folder: string; url?: string }; bytes: number }>(`/api/documents/${docId}/publish`, { method: "POST", body: { folder } }); },
    onSuccess: (r) => {
      setDirty(false); qc.setQueryData(docKey, r.document); invalidateLists();
      setSavedFile(r.file);
      notify(`Saved to Files — ${r.file.name} in "${r.file.folder}" · ${(r.bytes / 1024).toFixed(0)} KB`);
    },
    onError: (e) => fail(e, "Couldn't publish"),
  });

  // --- Editing ---------------------------------------------------------------
  const mutatePages = (fn: (p: DocumentPage[]) => DocumentPage[]) => { setPages((prev) => fn(prev)); setDirty(true); };
  const updatePage = (fn: (p: DocumentPage) => DocumentPage) => mutatePages((prev) => prev.map((p, i) => (i === pageIndex ? fn(p) : p)));
  const changeBlock = (blockId: string, patch: Partial<DocumentBlock>) => updatePage((p) => ({ ...p, blocks: p.blocks.map((b) => (b.id === blockId ? { ...b, ...patch } : b)) }));
  const moveBlock = (blockId: string, dir: -1 | 1) => updatePage((p) => {
    const list = ordered(p);
    const i = list.findIndex((b) => b.id === blockId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return p;
    const a = list[i], b = list[j];
    return { ...p, blocks: p.blocks.map((x) => x.id === a.id ? { ...x, row: b.row, col: b.col } : x.id === b.id ? { ...x, row: a.row, col: a.col } : x) };
  });
  const addBlock = () => {
    const id = newId();
    updatePage((p) => ({ ...p, blocks: [...p.blocks, { id, kind: "text", headline: "New block", intent: "", content: "", col: 0, row: rowCount(p), colSpan: p.columns, rowSpan: 1 }] }));
    setOpenBlock(id);
  };
  const addPage = (chapter: boolean) => {
    mutatePages((prev) => [...prev, {
      id: newId(), title: chapter ? "New chapter" : `Page ${prev.length + 1}`, purpose: "", columns: 1, isChapterPage: chapter,
      blocks: chapter ? [] : [{ id: newId(), kind: "heading", headline: "Section heading", intent: "", content: "", col: 0, row: 0, colSpan: 1, rowSpan: 1 }],
    }]);
    setPageIndex(pages.length);
  };
  const deletePage = () => {
    if (pages.length <= 1) return notify("A document needs at least one page", "info");
    mutatePages((prev) => prev.filter((_, i) => i !== pageIndex));
    setPageIndex((i) => Math.max(0, Math.min(i, pages.length - 2)));
  };

  if (isLoading) return <><Stack.Screen options={{ title: "Document" }} /><Loading /></>;
  if (!doc) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.canvas, justifyContent: "center" }}>
        <Stack.Screen options={{ title: "Document" }} />
        <Empty icon="document-outline" title="That document doesn't exist" body={(error as any)?.message} action="Back to project" onAction={() => router.replace(`/manage/${projectId}?tab=files` as any)} />
      </View>
    );
  }

  const page = pages[pageIndex];
  const printed = (i: number) => layout?.pages.find((lp) => lp.index === i)?.pdfPages ?? 1;
  const pageEmpty = page ? page.blocks.filter((b) => b.kind !== "spacer" && !b.content.trim()).length : 0;
  const accent = settings.accentColor || DEFAULT_SETTINGS.accentColor;

  return (
    <>
      <Stack.Screen options={{ title: "Document", headerRight: () => <IconButton name="options-outline" label="Layout" onPress={() => setSheet("layout")} /> }} />
      <ScrollView style={{ flex: 1, backgroundColor: colors.canvas }} contentContainerStyle={{ paddingBottom: spacing.xxl * 3 }} keyboardShouldPersistTaps="handled" stickyHeaderIndices={[1]}>
        {/* Title, save state and the document-wide actions. */}
        <View style={{ backgroundColor: colors.surface, padding: spacing.lg, gap: spacing.sm }}>
          <TextInput
            value={title} onChangeText={(t) => { setTitle(t); setDirty(true); }}
            style={{ fontSize: font.xl, fontFamily: fontFamily.bold, color: colors.text, padding: 0 }}
            placeholder="Untitled document" placeholderTextColor={colors.textTertiary} testID="input-doc-title"
          />
          <Row center gap={spacing.sm} wrap>
            {save.isPending ? <Meta>Saving…</Meta> : dirty
              ? <Row center gap={4}><View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.warning }} /><Meta>Unsaved</Meta></Row>
              : <Row center gap={4}><Icon name="checkmark" size={12} color={colors.success} /><Meta>Saved</Meta></Row>}
            <Meta>· {pages.length} page{pages.length === 1 ? "" : "s"}{layout && layout.totalPdfPages !== pages.length ? ` → ${layout.totalPdfPages} printed` : ""} · {words} words</Meta>
          </Row>
          <Row gap={spacing.sm} wrap>
            {pending > 0 ? (
              <Btn small icon="color-wand-outline" label={fill.isPending && !fillingBlock ? "Nova is writing…" : `Fill ${pending} empty block${pending === 1 ? "" : "s"}`}
                loading={fill.isPending && !fillingBlock} disabled={aiBusy > 0} onPress={() => fill.mutate({})} />
            ) : (
              <Btn small variant="outline" icon="refresh" label={fill.isPending && !fillingBlock ? "Nova is rewriting…" : `Rewrite all`}
                loading={fill.isPending && !fillingBlock} disabled={aiBusy > 0} onPress={() => fill.mutate({ refill: true })} />
            )}
            <Cost credits={pending > 0 ? (quote?.cost ?? pending) : (quote?.totalBlocks ?? 0)} />
            <Btn small variant="outline" icon="git-network-outline" label="Restructure" disabled={aiBusy > 0} onPress={() => setSheet("replan")} />
            <Btn small variant="outline" icon="cloud-upload-outline" label="Save to Files" onPress={() => setSheet("publish")} />
          </Row>
        </View>

        {/* The page strip. */}
        <View style={{ backgroundColor: colors.surface, borderBottomWidth: 1, borderTopWidth: 1, borderColor: colors.border }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ padding: spacing.sm, gap: spacing.sm }}>
            {pages.map((p, i) => {
              const on = i === pageIndex;
              const unwritten = !p.isChapterPage && p.blocks.some((b) => b.kind !== "spacer" && !b.content.trim());
              return (
                <Pressable key={p.id} onPress={() => { setPageIndex(i); setOpenBlock(null); setEditing(null); }}
                  style={{ width: 132, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primarySoft : colors.surface, borderRadius: radius.sm, padding: spacing.sm, gap: 2 }}
                  testID={`page-tab-${i}`}>
                  <Text numberOfLines={1} style={{ fontSize: font.xs + 1, fontFamily: fontFamily.semibold, color: colors.text }}>{i + 1}. {p.title || "Untitled"}</Text>
                  <Text numberOfLines={1} style={{ fontSize: 10.5, fontFamily: fontFamily.regular, color: unwritten || printed(i) > 1 ? colors.warning : colors.textTertiary }}>
                    {p.isChapterPage ? "chapter" : `${p.blocks.filter((b) => b.content.trim()).length}/${p.blocks.filter((b) => b.kind !== "spacer").length} written`}{printed(i) > 1 ? ` · prints as ${printed(i)}` : ""}
                  </Text>
                </Pressable>
              );
            })}
            <Pressable onPress={() => addPage(false)} style={{ width: 88, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", gap: 2 }} testID="button-add-page">
              <Icon name="add" size={16} color={colors.primary} />
              <Text style={{ fontSize: 10.5, color: colors.primary, fontFamily: fontFamily.semibold }}>Page</Text>
            </Pressable>
            <Pressable onPress={() => addPage(true)} style={{ width: 88, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", gap: 2 }}>
              <Icon name="bookmark-outline" size={15} color={colors.textSecondary} />
              <Text style={{ fontSize: 10.5, color: colors.textSecondary, fontFamily: fontFamily.semibold }}>Chapter</Text>
            </Pressable>
          </ScrollView>
        </View>

        <View style={{ padding: spacing.md, gap: spacing.md }}>
          {layout && layout.overflowing > 0 && (
            <View style={{ borderWidth: 1, borderColor: `${colors.warning}66`, backgroundColor: `${colors.warning}12`, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm }}>
              <Row gap={6} style={{ alignItems: "flex-start" }}>
                <Icon name="warning-outline" size={16} color={colors.warning} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.sm, color: colors.text }}>
                    {layout.overflowing === 1 ? "One page has more content than fits on it" : `${layout.overflowing} pages have more content than fits on them`}
                  </Text>
                  <Meta>This document is {pages.length} page{pages.length === 1 ? "" : "s"} here but prints as {layout.totalPdfPages}. Nova can cut the long pages down to fit, or trim a block yourself.</Meta>
                </View>
              </Row>
              <Btn small icon="cut-outline" label={tighten.isPending ? "Cutting…" : "Tighten to fit"} loading={tighten.isPending} disabled={aiBusy > 0} onPress={() => tighten.mutate(undefined)} style={{ alignSelf: "flex-start" }} />
            </View>
          )}
          {approach && (
            <View style={{ backgroundColor: colors.primarySoft, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm }}>
              <Row gap={6} style={{ alignItems: "flex-start" }}><Icon name="sparkles" size={15} color={colors.primary} /><Text style={{ flex: 1, fontSize: font.sm, lineHeight: 20, color: colors.text, fontFamily: fontFamily.regular }}>{approach}</Text></Row>
              <Btn small variant="ghost" label="Dismiss" onPress={() => setApproach(null)} style={{ alignSelf: "flex-start" }} />
            </View>
          )}

          {!page ? <Meta>This document has no pages.</Meta> : (
            <>
              {/* The page's own settings. */}
              <View style={card}>
                <Overline>Page {pageIndex + 1} title</Overline>
                <TextInput value={page.title} onChangeText={(t) => updatePage((p) => ({ ...p, title: t }))} style={inputStyle} testID="input-page-title" />
                <Overline>What this page is for — Nova uses this when writing</Overline>
                <TextInput value={page.purpose} onChangeText={(t) => updatePage((p) => ({ ...p, purpose: t }))} multiline style={[inputStyle, { minHeight: 56, textAlignVertical: "top" }]} testID="textarea-page-purpose" />
                {!page.isChapterPage && (
                  <Row center gap={6} wrap>
                    <Meta>Columns in print</Meta>
                    {Array.from({ length: MAX_GRID_COLUMNS }, (_, i) => i + 1).map((n) => (
                      <Bubble key={n} small label={String(n)} on={page.columns === n} onPress={() => updatePage((p) => ({ ...p, columns: n }))} />
                    ))}
                  </Row>
                )}
                <Row gap={spacing.sm} wrap>
                  {!page.isChapterPage && (
                    <Btn small variant={pageEmpty > 0 ? "primary" : "outline"} icon="color-wand-outline" label={pageEmpty > 0 ? `Fill this page (${pageEmpty})` : "Rewrite this page"}
                      loading={fill.isPending && !fillingBlock} disabled={aiBusy > 0} onPress={() => fill.mutate({ pageIndex, refill: pageEmpty === 0 })} />
                  )}
                  {printed(pageIndex) > 1 && <Btn small variant="outline" icon="cut-outline" label="Tighten this page" loading={tighten.isPending} disabled={aiBusy > 0} onPress={() => tighten.mutate(pageIndex)} />}
                  <Btn small variant="ghost" icon="trash-outline" label="Delete page" onPress={deletePage} />
                </Row>
              </View>

              {page.isChapterPage ? (
                <View style={[card, { alignItems: "center", paddingVertical: spacing.xxl, borderStyle: "dashed" }]}>
                  <Icon name="bookmark-outline" size={28} color={colors.textTertiary} />
                  <Text style={{ fontFamily: fontFamily.semibold, fontSize: font.sm, color: colors.text }}>Chapter divider</Text>
                  <Meta>Prints as a full page with just the chapter title. No blocks.</Meta>
                </View>
              ) : (
                <View style={[card, { borderTopWidth: 3, borderTopColor: accent }]}>
                  {!!settings.header && <Meta style={{ borderBottomWidth: 1, borderColor: colors.borderSubtle, paddingBottom: 6 }}>{settings.header}</Meta>}
                  {ordered(page).map((block, i, list) => {
                    const open = openBlock === block.id;
                    const isEditing = editing?.id === block.id;
                    const hasContent = !!block.content.trim();
                    return (
                      <View key={block.id} style={{ borderWidth: 1, borderColor: open || isEditing ? colors.primary : colors.border, borderStyle: block.kind === "spacer" ? "dashed" : "solid", borderRadius: radius.sm, overflow: "hidden" }} testID={`block-${block.id}`}>
                        <Row center gap={6} style={{ backgroundColor: colors.surfaceRaised, paddingHorizontal: spacing.sm, paddingVertical: 5 }}>
                          <Text style={{ flex: 1, fontSize: 10.5, fontFamily: fontFamily.semibold, color: colors.textTertiary, textTransform: "uppercase", letterSpacing: 0.5 }}>{BLOCK_KIND_LABELS[block.kind] ?? block.kind}{page.columns > 1 ? ` · ${Math.min(block.colSpan, page.columns)}/${page.columns} wide` : ""}</Text>
                          {block.kind !== "spacer" && (
                            <Pressable hitSlop={8} disabled={aiBusy > 0} onPress={() => { setFillingBlock(block.id); fill.mutate({ blockId: block.id }); }} accessibilityLabel={hasContent ? "Have Nova rewrite this block" : "Have Nova write this block"} testID={`block-fill-${block.id}`}>
                              {fill.isPending && fillingBlock === block.id ? <Text style={{ fontSize: font.xs, color: colors.primary, fontFamily: fontFamily.semibold }}>Writing…</Text> : <Icon name={hasContent ? "refresh" : "color-wand-outline"} size={16} color={aiBusy > 0 ? colors.textTertiary : colors.primary} />}
                            </Pressable>
                          )}
                          <Pressable hitSlop={8} onPress={() => setOpenBlock(open ? null : block.id)} accessibilityLabel="Block settings"><Icon name={open ? "chevron-up" : "ellipsis-horizontal"} size={16} color={colors.textSecondary} /></Pressable>
                        </Row>
                        <View style={{ padding: spacing.sm + 2, gap: 6 }}>
                          {!!block.headline && <Text style={{ fontSize: font.xs + 1, fontFamily: fontFamily.semibold, color: accent }}>{block.headline}</Text>}
                          {isEditing ? (
                            <View style={{ gap: 6 }}>
                              <TextInput autoFocus multiline value={editing.text} onChangeText={(t) => setEditing({ id: block.id, text: t })} placeholder={block.intent || "Write this block…"} placeholderTextColor={colors.textTertiary}
                                style={[inputStyle, { minHeight: 120, textAlignVertical: "top", fontSize: font.sm }]} testID={`block-editor-${block.id}`} />
                              <Row gap={spacing.sm}>
                                <Btn small icon="checkmark" label="Done" onPress={() => { if (editing.text !== block.content) changeBlock(block.id, { content: editing.text }); setEditing(null); }} />
                                <Btn small variant="ghost" label="Cancel" onPress={() => setEditing(null)} />
                              </Row>
                            </View>
                          ) : hasContent ? (
                            <Pressable onPress={() => setEditing({ id: block.id, text: block.content })}>
                              <Text style={{ fontSize: font.sm, lineHeight: 20, color: colors.text, fontFamily: block.kind === "heading" ? fontFamily.bold : fontFamily.regular }}>{block.content}</Text>
                            </Pressable>
                          ) : block.kind === "spacer" ? (
                            <Meta style={{ fontStyle: "italic" }}>Spacer</Meta>
                          ) : (
                            <Pressable onPress={() => setEditing({ id: block.id, text: "" })} style={{ gap: 4 }} testID={`block-empty-${block.id}`}>
                              {!!block.intent && <Meta numberOfLines={4}>{block.intent}</Meta>}
                              <Tag label="Empty — tap to write, or use Nova" color={colors.textSecondary} />
                            </Pressable>
                          )}
                        </View>
                        {open && (
                          <View style={{ borderTopWidth: 1, borderColor: colors.borderSubtle, padding: spacing.sm + 2, gap: spacing.sm }}>
                            <Overline>Block plan — Nova writes to this</Overline>
                            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5 }}>
                              {BLOCK_KINDS.map((k) => <Bubble key={k} small label={BLOCK_KIND_LABELS[k]} on={block.kind === k} onPress={() => changeBlock(block.id, { kind: k })} />)}
                            </View>
                            <TextInput value={block.headline} onChangeText={(t) => changeBlock(block.id, { headline: t })} placeholder="Headline" placeholderTextColor={colors.textTertiary} style={inputStyle} testID="input-block-headline" />
                            <TextInput value={block.intent} onChangeText={(t) => changeBlock(block.id, { intent: t })} multiline placeholder="What goes in it — be specific, this is the instruction Nova writes from." placeholderTextColor={colors.textTertiary} style={[inputStyle, { minHeight: 60, textAlignVertical: "top" }]} testID="textarea-block-intent" />
                            {page.columns > 1 && (
                              <Row center gap={6} wrap>
                                <Meta>Width</Meta>
                                {Array.from({ length: page.columns }, (_, n) => n + 1).map((n) => <Bubble key={n} small label={`${n}/${page.columns}`} on={Math.min(block.colSpan, page.columns) === n} onPress={() => changeBlock(block.id, { colSpan: n })} />)}
                              </Row>
                            )}
                            <Row gap={spacing.sm} wrap>
                              <Btn small variant="ghost" icon="arrow-up" label="Up" disabled={i === 0} onPress={() => moveBlock(block.id, -1)} />
                              <Btn small variant="ghost" icon="arrow-down" label="Down" disabled={i === list.length - 1} onPress={() => moveBlock(block.id, 1)} />
                              {hasContent && <Btn small variant="ghost" label="Clear content" onPress={() => changeBlock(block.id, { content: "" })} />}
                              <Btn small variant="danger" icon="trash-outline" label="Delete" onPress={() => { updatePage((p) => ({ ...p, blocks: p.blocks.filter((b) => b.id !== block.id) })); setOpenBlock(null); }} />
                            </Row>
                          </View>
                        )}
                      </View>
                    );
                  })}
                  <Btn small variant="outline" icon="add" label="Block" onPress={addBlock} style={{ alignSelf: "flex-start" }} />
                  {(settings.footer || settings.showPageNumbers) && (
                    <Meta style={{ textAlign: "center", borderTopWidth: 1, borderColor: colors.borderSubtle, paddingTop: 6 }}>
                      {[settings.footer, settings.showPageNumbers ? `${pageIndex + 1} / ${pages.length}` : null].filter(Boolean).join("   ·   ")}
                    </Meta>
                  )}
                </View>
              )}
            </>
          )}
        </View>
      </ScrollView>

      {/* Layout */}
      <Sheet visible={sheet === "layout"} onClose={() => setSheet(null)} title="Layout" subtitle="How every printed page looks.">
        {([["subtitle", "Subtitle", ""], ["header", "Running header", "Top of every page"], ["footer", "Footer", "Bottom of every page"]] as const).map(([k, label, ph]) => (
          <View key={k} style={{ gap: 4 }}>
            <Meta>{label}</Meta>
            <TextInput value={settings[k]} placeholder={ph} placeholderTextColor={colors.textTertiary} onChangeText={(t) => { setSettings((s) => ({ ...s, [k]: t })); setDirty(true); }} style={inputStyle} />
          </View>
        ))}
        {([["titlePage", "Title page"], ["showPageNumbers", "Page numbers"]] as const).map(([k, label]) => (
          <Row key={k} between>
            <Text style={{ fontSize: font.sm, fontFamily: fontFamily.medium, color: colors.text }}>{label}</Text>
            <Switch value={settings[k]} onValueChange={(v) => { setSettings((s) => ({ ...s, [k]: v })); setDirty(true); }} trackColor={{ false: colors.border, true: colors.primary }} thumbColor="#FFFFFF" />
          </Row>
        ))}
        <Row center gap={spacing.sm} wrap>
          <Text style={{ fontSize: font.sm, fontFamily: fontFamily.medium, color: colors.text }}>Accent</Text>
          {ACCENTS.map((c) => (
            <Pressable key={c} onPress={() => { setSettings((s) => ({ ...s, accentColor: c })); setDirty(true); }} accessibilityLabel={`Accent ${c}`}
              style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: c, borderWidth: accent.toLowerCase() === c.toLowerCase() ? 3 : 0, borderColor: colors.primarySoft }} />
          ))}
        </Row>
        <Btn small label="Done" onPress={() => setSheet(null)} style={{ alignSelf: "flex-end" }} />
      </Sheet>

      {/* Restructure */}
      <Sheet visible={sheet === "replan"} onClose={() => setSheet(null)} title="Restructure this document" subtitle="Nova re-plans the pages and the grid. Blocks you've already written keep their content — it's the shape that changes.">
        <Meta>What's wrong with the current shape?</Meta>
        <TextInput value={replanFeedback} onChangeText={setReplanFeedback} multiline placeholder="e.g. Too many pages — get it down to two. Put the metrics beside the loop steps." placeholderTextColor={colors.textTertiary} style={[inputStyle, { minHeight: 90, textAlignVertical: "top" }]} testID="textarea-replan-feedback" />
        {words > 0 && <Meta style={{ color: colors.warning }}>You have {words} words written. Content moves with its block, but a block Nova drops takes its text with it.</Meta>}
        <Row gap={spacing.sm} style={{ justifyContent: "flex-end" }} center>
          <Btn small variant="ghost" label="Cancel" onPress={() => setSheet(null)} />
          <Cost credits={DOCUMENT_PLAN_COST} />
          <Btn small label={replan.isPending ? "Restructuring…" : "Restructure"} loading={replan.isPending} onPress={() => replan.mutate()} />
        </Row>
      </Sheet>

      {/* Save to Files */}
      <Sheet visible={sheet === "publish"} onClose={() => { setSheet(null); setSavedFile(null); }} title="Save to Files" subtitle="Renders a PDF into the project's Files. The document stays editable here, and saving again replaces the PDF.">
        {savedFile ? (
          <>
            <Row gap={6} center><Icon name="checkmark-circle" size={18} color={colors.success} /><Text style={{ flex: 1, fontSize: font.sm, fontFamily: fontFamily.medium, color: colors.text }}>{savedFile.name} in "{savedFile.folder}"</Text></Row>
            <Row gap={spacing.sm} wrap style={{ justifyContent: "flex-end" }}>
              {!!savedFile.url && <Btn small variant="outline" icon="open-outline" label="Open PDF" onPress={() => { const u = assetUri(savedFile.url); if (u) void Linking.openURL(u).catch(() => {}); }} />}
              <Btn small variant="outline" icon="folder-open-outline" label="Go to Files" onPress={() => { setSheet(null); router.push(`/manage/${projectId}?tab=files` as any); }} />
              <Btn small label="Done" onPress={() => { setSheet(null); setSavedFile(null); }} />
            </Row>
          </>
        ) : (
          <>
            <Meta>Folder</Meta>
            <TextInput value={folder} onChangeText={setFolder} placeholder="docs" autoCapitalize="none" placeholderTextColor={colors.textTertiary} style={inputStyle} testID="input-publish-folder" />
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5 }}>
              {FOLDER_SUGGESTIONS.map((f) => <Bubble key={f} small label={f} on={folder === f} onPress={() => setFolder(f)} />)}
            </View>
            {pending > 0 && <Meta style={{ color: colors.warning }}>{pending} block{pending === 1 ? " is" : "s are"} still empty and will print blank.</Meta>}
            {layout && <Meta>The PDF will be {layout.totalPdfPages} page{layout.totalPdfPages === 1 ? "" : "s"}{layout.overflowing > 0 ? " — some pages overflow. Tighten first if that matters." : ""}</Meta>}
            <Row gap={spacing.sm} style={{ justifyContent: "flex-end" }}>
              <Btn small variant="ghost" label="Cancel" onPress={() => setSheet(null)} />
              <Btn small icon="save-outline" label={publish.isPending ? "Rendering…" : "Save PDF to Files"} loading={publish.isPending} disabled={!folder.trim()} onPress={() => publish.mutate()} />
            </Row>
          </>
        )}
      </Sheet>
    </>
  );
}

const card = { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm, ...shadow.card } as const;
const inputStyle = {
  backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
  paddingHorizontal: spacing.md, paddingVertical: 9, color: colors.text, fontSize: font.sm + 1, fontFamily: fontFamily.regular,
} as const;
