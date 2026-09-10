import { useEffect, useMemo, useRef, useState } from "react";
import { snowflakeLayout, suggestConsolidations, type DataShape, type MapNode } from "@shared/data-shape";
import { Button } from "@/components/ui/button";
import { ZoomIn, ZoomOut, Maximize2, Lightbulb } from "lucide-react";

/** Where a line from the centre of `a` toward `b` leaves a's box. */
function edgePoint(a: MapNode, b: MapNode) {
  const dx = b.x - a.x, dy = b.y - a.y;
  if (!dx && !dy) return { x: a.x, y: a.y };
  const hw = a.w / 2, hh = a.h / 2;
  const t = Math.min(hw / Math.abs(dx || 1e-9), hh / Math.abs(dy || 1e-9));
  return { x: a.x + dx * t, y: a.y + dy * t };
}

/**
 * The data map as a snowflake of table boxes: the hub at the centre, every
 * table placed outward from the one it references, crow's feet on the
 * many side of each relation. Wheel to zoom, drag to pan, buttons to
 * step or fit. Click a table for its columns and both directions of its
 * relations; the consolidation panel names where the schema could be
 * simpler and why.
 */
export function DataMap({ shape }: { shape: DataShape }) {
  const [open, setOpen] = useState<string | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [allEdges, setAllEdges] = useState(false);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const layout = useMemo(() => snowflakeLayout(shape), [shape]);
  const cons = useMemo(() => suggestConsolidations(shape), [shape]);
  const byName = useMemo(() => new Map(shape.tables.map((t) => [t.name, t])), [shape]);
  const pos = useMemo(() => new Map(layout.nodes.map((n) => [n.name, n])), [layout]);
  const selected = open ? byName.get(open) : null;
  const VIEW_W = 900, VIEW_H = 620;
  const fit = () => { const k = Math.min(VIEW_W / layout.width, VIEW_H / layout.height); setView({ k, x: (VIEW_W - layout.width * k) / 2, y: (VIEW_H - layout.height * k) / 2 }); };
  const zoomBy = (f: number, cx = VIEW_W / 2, cy = VIEW_H / 2) => setView((v) => {
    const k = Math.min(4, Math.max(0.15, v.k * f));
    return { k, x: cx - (cx - v.x) * (k / v.k), y: cy - (cy - v.y) * (k / v.k) };
  });
  const fitted = useRef(false);
  if (!fitted.current && layout.nodes.length) { fitted.current = true; setTimeout(fit, 0); }
  const canvas = useRef<HTMLDivElement>(null);
  // React registers wheel listeners as passive, so preventDefault there does
  // nothing and the page scrolls under the map. A native, non-passive
  // listener is the only way to keep the wheel on the map.
  useEffect(() => {
    const el = canvas.current; if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomBy(e.deltaY < 0 ? 1.12 : 0.9, (e.clientX - r.left) * (VIEW_W / r.width), (e.clientY - r.top) * (VIEW_H / r.height));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  if (shape.error) return <p className="text-sm text-muted-foreground" data-testid="data-map-error">The data read failed: {shape.error}</p>;
  if (!shape.tables.length) return <p className="text-sm text-muted-foreground">No tables found.</p>;

  const related = (name: string) => layout.edges.filter((e) => e.from === name || e.to === name);
  const hot = new Set(open ? related(open).flatMap((e) => [e.from, e.to]) : []);

  return (
    <div className="space-y-3" data-testid="data-map">
      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
        <span>{shape.totals.tables} tables · {layout.edges.length} relations · {shape.totals.rows.toLocaleString()} rows · {shape.totals.emptyTables} empty</span>
        <span>hub: <span className="font-medium text-foreground">{layout.hub}</span></span>
        <span className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => zoomBy(1.25)} data-testid="map-zoom-in" title="Zoom in"><ZoomIn className="h-3.5 w-3.5" /></Button>
          <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => zoomBy(0.8)} data-testid="map-zoom-out" title="Zoom out"><ZoomOut className="h-3.5 w-3.5" /></Button>
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={fit} data-testid="map-fit" title="Fit to view"><Maximize2 className="h-3.5 w-3.5 mr-1" />Fit</Button>
          <Button size="sm" variant={allEdges ? "default" : "outline"} className="h-7 px-2 text-xs" onClick={() => setAllEdges((v) => !v)} data-testid="map-all-edges" title="Show every relation, not just the tree">{allEdges ? "All relations" : "Tree only"}</Button>
        </span>
      </div>
      {shape.compare && (shape.compare.inCodeNotInDb.length > 0 || shape.compare.inDbNotInCode.length > 0) && (
        <p className="text-xs text-amber-700 dark:text-amber-400" data-testid="data-map-drift">
          Schema drift · in code but not in the database: {shape.compare.inCodeNotInDb.join(", ") || "none"} · in the database but not in code: {shape.compare.inDbNotInCode.join(", ") || "none"}
        </p>
      )}

      <div className="grid gap-3 lg:grid-cols-[1fr_18rem]">
        <div ref={canvas} className="rounded-md border border-border bg-muted/20 overflow-hidden select-none touch-none" style={{ height: VIEW_H }}
          onPointerDown={(e) => { if (e.button !== 0) return; drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false }; }}
          onPointerMove={(e) => {
            const d = drag.current; if (!d) return;
            // A drag only starts after real movement, so a click on a box stays a click.
            if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return;
            d.moved = true;
            // Read the drag origin now: by the time a queued state update runs, pointer-up may have cleared it.
            const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
            const sx = VIEW_W / r.width, sy = VIEW_H / r.height;
            const nx = d.vx + (e.clientX - d.x) * sx, ny = d.vy + (e.clientY - d.y) * sy;
            setView((v) => ({ ...v, x: nx, y: ny }));
          }}
          onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onPointerLeave={() => { drag.current = null; }}
          data-testid="map-canvas">
          <svg width="100%" height="100%" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} role="img" aria-label="Data map" className="cursor-grab active:cursor-grabbing">
            <defs>
              {/* Crow's foot on the many side; a bar on the one side. */}
              <marker id="crow" viewBox="0 0 14 14" refX="1" refY="7" markerWidth="14" markerHeight="14" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
                <path d="M13 7 L1 1 M13 7 L1 7 M13 7 L1 13" fill="none" stroke="currentColor" strokeWidth="1.4" />
              </marker>
              <marker id="one" viewBox="0 0 10 14" refX="9" refY="7" markerWidth="10" markerHeight="14" orient="auto" markerUnits="userSpaceOnUse">
                <path d="M6 1 L6 13" fill="none" stroke="currentColor" strokeWidth="1.4" />
              </marker>
            </defs>
            <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
              {layout.edges.map((e, i) => {
                const a = pos.get(e.from), b = pos.get(e.to);
                if (!a || !b) return null;
                // Only the tree by default: every extra relation is a line across the map. All of them, or the selected table's, on request.
                if (!e.tree && !allEdges && !(open && (e.from === open || e.to === open))) return null;
                const p1 = edgePoint(a, b), p2 = edgePoint(b, a);
                const isHot = open && (e.from === open || e.to === open);
                return (
                  <line key={i} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="currentColor"
                    className={isHot ? "text-primary" : e.tree ? "text-muted-foreground/45" : "text-muted-foreground/20"}
                    strokeWidth={isHot ? 1.8 : 1} strokeDasharray={e.tree ? undefined : "4 3"}
                    markerStart="url(#crow)" markerEnd="url(#one)" />
                );
              })}
              {layout.nodes.map((n) => {
                const t = byName.get(n.name)!;
                const empty = n.rows === 0;
                const isOpen = open === n.name;
                const dim = open && !isOpen && !hot.has(n.name);
                const keys = t.columns.filter((c) => c.pk).map((c) => c.name).slice(0, 2);
                const fks = t.foreignKeys.length;
                return (
                  <g key={n.name} transform={`translate(${n.x - n.w / 2},${n.y - n.h / 2})`} className="cursor-pointer" opacity={dim ? 0.35 : 1}
                    onClick={(ev) => { ev.stopPropagation(); setOpen(isOpen ? null : n.name); }} data-testid={`node-${n.name}`}>
                    <rect width={n.w} height={n.h} rx={6} fill="currentColor" className={isOpen ? "text-primary/15" : n.depth === 0 ? "text-primary/10" : "text-background"} />
                    <rect width={n.w} height={n.h} rx={6} fill="none" stroke="currentColor" strokeWidth={isOpen ? 2.5 : n.depth === 0 ? 2 : 1.2}
                      strokeDasharray={empty ? "5 3" : undefined} className={isOpen ? "text-primary" : empty ? "text-muted-foreground/60" : n.depth === 0 ? "text-primary" : "text-muted-foreground/70"} />
                    <rect width={n.w} height={18} rx={6} fill="currentColor" className={n.depth === 0 ? "text-primary/25" : "text-muted/80"} />
                    <text x={8} y={13} fontSize={11} fontWeight={600} className="fill-foreground">{n.name.length > 22 ? n.name.slice(0, 21) + "…" : n.name}</text>
                    <text x={n.w - 8} y={13} fontSize={9.5} textAnchor="end" className="fill-muted-foreground">{n.rows.toLocaleString()}{t.exact ? "" : "~"} rows</text>
                    <text x={8} y={33} fontSize={9.5} className="fill-muted-foreground">{keys.length ? `PK ${keys.join(", ")}` : "no primary key"}</text>
                    <text x={8} y={47} fontSize={9.5} className="fill-muted-foreground">{t.columns.length} cols · {fks} FK{fks === 1 ? "" : "s"} · {t.inbound} referenced by</text>
                  </g>
                );
              })}
            </g>
          </svg>
        </div>

        <div className="rounded-md border border-border p-3 text-xs space-y-3 overflow-auto" style={{ maxHeight: VIEW_H }} data-testid="data-map-detail">
          {selected ? (
            <>
              <p className="font-semibold text-sm">{selected.name} <span className="font-normal text-muted-foreground">· {selected.rows.toLocaleString()} rows{selected.exact ? "" : " (estimate)"}</span></p>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Columns</p>
                <ul className="space-y-0.5 max-h-52 overflow-auto">
                  {selected.columns.map((c) => (
                    <li key={c.name} className="flex justify-between gap-2">
                      <span>{c.pk && <span className="text-primary mr-1">PK</span>}{c.name}{selected.foreignKeys.some((f) => f.column === c.name) && <span className="text-muted-foreground ml-1">→ {selected.foreignKeys.find((f) => f.column === c.name)!.refTable}</span>}</span>
                      <span className="text-muted-foreground shrink-0">{c.type}{c.nullable ? "?" : ""}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Relations</p>
                <ul className="space-y-0.5">
                  {selected.foreignKeys.map((f) => <li key={f.column}>many <span className="font-medium">{selected.name}</span> → one <button className="underline" onClick={() => setOpen(f.refTable)}>{f.refTable}</button> <span className="text-muted-foreground">via {f.column}</span></li>)}
                  {related(selected.name).filter((e) => e.to === selected.name).map((e) => <li key={e.from + e.column}>one <span className="font-medium">{selected.name}</span> ← many <button className="underline" onClick={() => setOpen(e.from)}>{e.from}</button> <span className="text-muted-foreground">via {e.column}</span></li>)}
                  {!related(selected.name).length && <li className="text-muted-foreground">Stands alone: no relations either way.</li>}
                </ul>
              </div>
            </>
          ) : (
            <>
              <p className="text-muted-foreground">Click a table for its columns and relations. Solid lines are the tree from the hub; the selected table's other relations show dashed, or all of them with "All relations". Crow's feet mark the many side.</p>
              <p className="text-muted-foreground">Dashed boxes are empty tables.</p>
            </>
          )}
          <div className="border-t border-border pt-2" data-testid="consolidations">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1"><Lightbulb className="h-3 w-3" />Could be simpler</p>
            {cons.length ? (
              <ul className="space-y-1.5">
                {cons.map((c, i) => (
                  <li key={i}>
                    <p className="font-medium">{c.tables.map((t, j) => <span key={t}>{j > 0 && " + "}<button className="underline" onClick={() => setOpen(t)}>{t}</button></span>)}</p>
                    <p className="text-muted-foreground">{c.reason} {c.suggestion}</p>
                  </li>
                ))}
              </ul>
            ) : <p className="text-muted-foreground">Nothing obvious. Every table has a distinct shape and a place.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
