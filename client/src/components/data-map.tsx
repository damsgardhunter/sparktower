import { useMemo, useState } from "react";
import { starLayout, type DataShape } from "@shared/data-shape";

/**
 * The data map: a star of the live database. The most-referenced table at
 * the centre, what points at it on the first ring, the rest outside; node
 * size follows row count, and an empty table is drawn hollow. Click a
 * table for its columns and keys.
 */
export function DataMap({ shape }: { shape: DataShape }) {
  const [open, setOpen] = useState<string | null>(null);
  const layout = useMemo(() => starLayout(shape, 760), [shape]);
  const byName = useMemo(() => new Map(shape.tables.map((t) => [t.name, t])), [shape]);
  const pos = useMemo(() => new Map(layout.nodes.map((n) => [n.name, n])), [layout]);
  const selected = open ? byName.get(open) : null;

  if (shape.error) return <p className="text-sm text-muted-foreground" data-testid="data-map-error">The data read failed: {shape.error}</p>;
  if (!shape.tables.length) return <p className="text-sm text-muted-foreground">No tables found.</p>;

  return (
    <div className="space-y-3" data-testid="data-map">
      <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
        <span>{shape.totals.tables} tables · {shape.totals.rows.toLocaleString()} rows · {shape.totals.emptyTables} empty</span>
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-full bg-primary/70" /> has rows</span>
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-full border-2 border-muted-foreground/50" /> empty</span>
        <span>size = rows (log scale)</span>
      </div>
      {shape.compare && (shape.compare.inCodeNotInDb.length > 0 || shape.compare.inDbNotInCode.length > 0) && (
        <p className="text-xs text-amber-700 dark:text-amber-400" data-testid="data-map-drift">
          Schema drift · in code but not in the database: {shape.compare.inCodeNotInDb.join(", ") || "none"} · in the database but not in code: {shape.compare.inDbNotInCode.join(", ") || "none"}
        </p>
      )}
      <div className="grid gap-3 lg:grid-cols-[1fr_16rem]">
        <div className="overflow-auto rounded-md border border-border bg-muted/20">
          <svg viewBox={`0 0 ${layout.width} ${layout.height}`} className="w-full min-w-[520px]" role="img" aria-label="Data map">
            {layout.edges.map((e, i) => {
              const a = pos.get(e.from), b = pos.get(e.to);
              if (!a || !b) return null;
              const hot = open && (e.from === open || e.to === open);
              return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="currentColor" className={hot ? "text-primary" : "text-muted-foreground/25"} strokeWidth={hot ? 1.6 : 0.8} />;
            })}
            {layout.nodes.map((n) => {
              const empty = n.rows === 0;
              const isOpen = open === n.name;
              return (
                <g key={n.name} transform={`translate(${n.x},${n.y})`} className="cursor-pointer" onClick={() => setOpen(isOpen ? null : n.name)} data-testid={`node-${n.name}`}>
                  <circle r={n.r} fill={empty ? "transparent" : "currentColor"} stroke="currentColor" strokeWidth={isOpen ? 3 : empty ? 2 : 1}
                    className={isOpen ? "text-primary" : empty ? "text-muted-foreground/60" : n.ring === 0 ? "text-primary/80" : "text-primary/55"} />
                  <text y={n.r + 11} textAnchor="middle" fontSize={n.ring === 0 ? 12 : 10} className="fill-foreground select-none">{n.name}</text>
                  <text y={n.r + 21} textAnchor="middle" fontSize={9} className="fill-muted-foreground select-none">{n.rows.toLocaleString()}{byName.get(n.name)?.exact ? "" : "~"}</text>
                </g>
              );
            })}
          </svg>
        </div>
        <div className="rounded-md border border-border p-3 text-xs space-y-2 min-h-[8rem]" data-testid="data-map-detail">
          {selected ? (
            <>
              <p className="font-semibold text-sm">{selected.name} <span className="font-normal text-muted-foreground">· {selected.rows.toLocaleString()} rows{selected.exact ? "" : " (estimate)"}</span></p>
              <ul className="space-y-0.5 max-h-72 overflow-auto">
                {selected.columns.map((c) => (
                  <li key={c.name} className="flex justify-between gap-2">
                    <span>{c.pk && <span className="text-primary mr-1">PK</span>}{c.name}{selected.foreignKeys.some((f) => f.column === c.name) && <span className="text-muted-foreground ml-1">→ {selected.foreignKeys.find((f) => f.column === c.name)!.refTable}</span>}</span>
                    <span className="text-muted-foreground shrink-0">{c.type}{c.nullable ? "?" : ""}</span>
                  </li>
                ))}
              </ul>
              {selected.inbound > 0 && <p className="text-muted-foreground">Referenced by {selected.inbound} table{selected.inbound === 1 ? "" : "s"}.</p>}
            </>
          ) : <p className="text-muted-foreground">Click a table to see its columns and keys.</p>}
        </div>
      </div>
    </div>
  );
}
