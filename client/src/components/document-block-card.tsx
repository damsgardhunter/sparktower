import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Loader2, GripVertical, Wand2, Pencil, Check, Trash2, MoreVertical,
  ChevronLeft, ChevronRight, RotateCcw,
} from "lucide-react";
import {
  BLOCK_KINDS, BLOCK_KIND_LABELS, type BlockKind, type DocumentBlock,
} from "@shared/documents";

export const BLOCK_DRAG_TYPE = "application/x-sparktower-block";

/**
 * One block on the page grid.
 *
 * Three states in one card, because they're the same object at different
 * stages: planned (a headline and an intent, no prose), filled (rendered
 * markdown), and editing (a textarea). Keeping them in one card is what makes
 * the grid legible before anything is written — the layout you approve is
 * literally the layout you end up with.
 */
export function DocumentBlockCard({
  block, columns, accent, isDragging, filling, readOnly,
  onDragStart, onDragEnd, onChange, onDelete, onFill, onSelect, isSelected,
}: {
  block: DocumentBlock;
  columns: number;
  accent: string;
  isDragging: boolean;
  filling: boolean;
  readOnly?: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onChange: (patch: Partial<DocumentBlock>) => void;
  onDelete: () => void;
  onFill: (guidance?: string) => void;
  onSelect: () => void;
  isSelected: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(block.content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // A fill that lands while the editor is closed should show up immediately.
  useEffect(() => {
    if (!editing) setDraft(block.content);
  }, [block.content, editing]);

  useEffect(() => {
    if (editing) textareaRef.current?.focus();
  }, [editing]);

  const commit = () => {
    if (draft !== block.content) onChange({ content: draft });
    setEditing(false);
  };

  const hasContent = !!block.content.trim();

  return (
    <div
      className={`group relative flex flex-col rounded-md border bg-card transition-all ${
        isSelected ? "border-primary ring-1 ring-primary/40" : "border-border/70"
      } ${isDragging ? "opacity-30" : ""} ${block.kind === "spacer" ? "border-dashed" : ""}`}
      style={{
        gridColumn: `${block.col + 1} / span ${Math.min(block.colSpan, columns)}`,
        gridRow: `${block.row + 1} / span ${block.rowSpan}`,
      }}
      onClick={onSelect}
      data-testid={`block-${block.id}`}
    >
      {/* Header: drag handle, kind, and the controls. Always visible while
          planning, since that's when the shape is being decided. */}
      <div className="flex items-center gap-1 px-1.5 py-1 border-b border-border/50 bg-muted/30 rounded-t-md">
        {!readOnly && (
          <span
            draggable
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground shrink-0"
            title="Drag to move this block"
            data-testid={`block-handle-${block.id}`}
          >
            <GripVertical className="h-3.5 w-3.5" />
          </span>
        )}

        {readOnly ? (
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {BLOCK_KIND_LABELS[block.kind]}
          </span>
        ) : (
          <Select value={block.kind} onValueChange={(v) => onChange({ kind: v as BlockKind })}>
            <SelectTrigger
              className="h-6 w-[7.5rem] text-[10px] border-0 bg-transparent px-1 shadow-none focus:ring-0"
              data-testid={`block-kind-${block.id}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BLOCK_KINDS.map((k) => (
                <SelectItem key={k} value={k} className="text-xs">{BLOCK_KIND_LABELS[k]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <span className="ml-auto flex items-center gap-0.5 shrink-0">
          {!readOnly && (
            <>
              {/* Width, in grid columns. Kept as buttons rather than a resize
                  handle — a 1-of-3 column target is a fiddly drag. */}
              <Button
                variant="ghost" size="icon" className="h-6 w-6"
                title="Narrower"
                disabled={block.colSpan <= 1}
                onClick={(e) => { e.stopPropagation(); onChange({ colSpan: block.colSpan - 1 }); }}
                data-testid={`block-narrower-${block.id}`}
              >
                <ChevronLeft className="h-3 w-3" />
              </Button>
              <span className="text-[10px] text-muted-foreground tabular-nums w-6 text-center">
                {block.colSpan}/{columns}
              </span>
              <Button
                variant="ghost" size="icon" className="h-6 w-6"
                title="Wider"
                disabled={block.colSpan >= columns}
                onClick={(e) => { e.stopPropagation(); onChange({ colSpan: block.colSpan + 1 }); }}
                data-testid={`block-wider-${block.id}`}
              >
                <ChevronRight className="h-3 w-3" />
              </Button>

              {block.kind !== "spacer" && (
                <Button
                  variant="ghost" size="icon" className="h-6 w-6"
                  title={hasContent ? "Have Nova rewrite this block" : "Have Nova write this block"}
                  disabled={filling}
                  onClick={(e) => { e.stopPropagation(); onFill(); }}
                  data-testid={`block-fill-${block.id}`}
                >
                  {filling
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : hasContent ? <RotateCcw className="h-3 w-3" /> : <Wand2 className="h-3 w-3 text-primary" />}
                </Button>
              )}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => e.stopPropagation()} data-testid={`block-menu-${block.id}`}>
                    <MoreVertical className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onChange({ rowSpan: Math.min(4, block.rowSpan + 1) })}>
                    Taller
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={block.rowSpan <= 1}
                    onClick={() => onChange({ rowSpan: block.rowSpan - 1 })}
                  >
                    Shorter
                  </DropdownMenuItem>
                  {hasContent && (
                    <DropdownMenuItem onClick={() => onChange({ content: "" })}>
                      Clear content
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem className="text-destructive" onClick={onDelete}>
                    <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete block
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </span>
      </div>

      <div className="flex-1 min-h-0 p-2.5 space-y-1.5 overflow-hidden">
        {/* Nova's plan for the block. This is the thing being approved before
            any prose exists, so it stays visible even once filled. */}
        {block.headline && (
          <p className="text-[11px] font-semibold leading-snug" style={{ color: accent }}>
            {block.headline}
          </p>
        )}

        {editing ? (
          <div className="space-y-1.5">
            <Textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Escape") { setDraft(block.content); setEditing(false); }
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commit();
              }}
              placeholder={block.intent || "Write this block…"}
              className="min-h-[120px] text-xs font-mono"
              onClick={(e) => e.stopPropagation()}
              data-testid={`block-editor-${block.id}`}
            />
            <div className="flex items-center gap-1.5">
              <Button size="sm" className="h-6 gap-1 text-[11px]" onClick={(e) => { e.stopPropagation(); commit(); }}>
                <Check className="h-3 w-3" /> Done
              </Button>
              <span className="text-[10px] text-muted-foreground">⌘↵ to save · Esc to cancel</span>
            </div>
          </div>
        ) : hasContent ? (
          <div
            className="prose prose-sm dark:prose-invert max-w-none text-xs leading-relaxed [&_*]:my-1 [&_table]:text-[10px] [&_h1]:text-sm [&_h2]:text-sm cursor-text"
            onClick={(e) => { if (!readOnly) { e.stopPropagation(); setEditing(true); } }}
            data-testid={`block-content-${block.id}`}
          >
            <ReactMarkdown>{block.content}</ReactMarkdown>
          </div>
        ) : block.kind === "spacer" ? (
          <p className="text-[10px] text-muted-foreground italic">Spacer</p>
        ) : (
          <button
            type="button"
            className="w-full text-left space-y-1 group/empty"
            onClick={(e) => { if (!readOnly) { e.stopPropagation(); setEditing(true); } }}
            data-testid={`block-empty-${block.id}`}
          >
            {block.intent && (
              <p className="text-[10px] text-muted-foreground leading-relaxed line-clamp-4">{block.intent}</p>
            )}
            <Badge variant="outline" className="text-[9px] font-normal gap-1">
              <Pencil className="h-2.5 w-2.5" /> empty — click to write, or use Nova
            </Badge>
          </button>
        )}
      </div>
    </div>
  );
}
