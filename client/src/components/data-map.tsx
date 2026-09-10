import { useMemo, useState } from "react";
import { relatedTables, hubTable, suggestConsolidations, type DataShape, type RelatedTable } from "@shared/data-shape";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ChevronRight, Lightbulb, Database } from "lucide-react";

/** The relation between the current table (off to the left) and a listed one: crow's foot on the many side. */
function RelationGlyph({ direction }: { direction: RelatedTable["direction"] }) {
  // Left end = current table, right end = the listed table.
  const many = direction === "referenced-by" ? "right" : "left";
  return (
    <svg width="64" height="28" viewBox="0 0 64 28" className="text-muted-foreground shrink-0" aria-hidden>
      <line x1="10" y1="14" x2="54" y2="14" stroke="currentColor" strokeWidth="1.6" />
      {many === "left"
        ? <path d="M10 14 L0 6 M10 14 L0 14 M10 14 L0 22" fill="none" stroke="currentColor" strokeWidth="1.6" />
        : <path d="M14 6 L14 22" fill="none" stroke="currentColor" strokeWidth="1.6" />}
      {many === "right"
        ? <path d="M54 14 L64 6 M54 14 L64 14 M54 14 L64 22" fill="none" stroke="currentColor" strokeWidth="1.6" />
        : <path d="M50 6 L50 22" fill="none" stroke="currentColor" strokeWidth="1.6" />}
    </svg>
  );
}

/** A stub going on to the right: this table has relations beyond the current one. */
function FurtherStub({ count }: { count: number }) {
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0" title={`${count} more relation${count === 1 ? "" : "s"} from here`}>
      <svg width="40" height="28" viewBox="0 0 40 28" aria-hidden>
        <line x1="0" y1="14" x2="26" y2="14" stroke="currentColor" strokeWidth="1.6" />
        <path d="M26 14 L36 6 M26 14 L36 14 M26 14 L36 22" fill="none" stroke="currentColor" strokeWidth="1.6" />
      </svg>
      +{count}
    </span>
  );
}

/**
 * The database as a star you walk, not a picture you squint at. It opens
 * on the hub table alone. Open it and you see the tables one hop away as
 * a list: the relation glyph on the left (crow's foot on the many side),
 * the table with its key columns, and on the right a stub if the trail
 * goes further. Click any to step into it; breadcrumbs and Back bring
 * you home. Columns of the current table are listed below, with the
 * foreign keys as links.
 */
export function DataMap({ shape }: { shape: DataShape }) {
  const hub = useMemo(() => hubTable(shape), [shape]);
  const [trail, setTrail] = useState<string[]>([]);
  const [showCons, setShowCons] = useState(false);
  const byName = useMemo(() => new Map(shape.tables.map((t) => [t.name, t])), [shape]);
  const cons = useMemo(() => suggestConsolidations(shape), [shape]);
  const current = trail[trail.length - 1] ?? null;
  const table = current ? byName.get(current) : null;
  const related = useMemo(() => (current ? relatedTables(shape, current) : []), [shape, current]);
  const go = (name: string) => setTrail((t) => [...t, name]);
  const back = () => setTrail((t) => t.slice(0, -1));

  if (shape.error) return <p className="text-sm text-muted-foreground" data-testid="data-map-error">The data read failed: {shape.error}</p>;
  if (!shape.tables.length || !hub) return <p className="text-sm text-muted-foreground">No tables found.</p>;

  const Header = () => (
    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
      <span>{shape.totals.tables} tables · {shape.totals.rows.toLocaleString()} rows · {shape.totals.emptyTables} empty</span>
      {shape.compare && (shape.compare.inCodeNotInDb.length > 0 || shape.compare.inDbNotInCode.length > 0) && (
        <span className="text-amber-700 dark:text-amber-400" data-testid="data-map-drift">drift: code-only {shape.compare.inCodeNotInDb.join(", ") || "none"} · db-only {shape.compare.inDbNotInCode.join(", ") || "none"}</span>
      )}
      <button className="ml-auto flex items-center gap-1 hover:text-foreground" onClick={() => setShowCons((v) => !v)} data-testid="toggle-consolidations"><Lightbulb className="h-3 w-3" />Could be simpler ({cons.length})</button>
    </div>
  );

  const Consolidations = () => showCons ? (
    <div className="rounded-md border border-border p-3 text-xs space-y-1.5" data-testid="consolidations">
      {cons.length ? cons.map((c, i) => (
        <div key={i}>
          <p className="font-medium">{c.tables.map((t, j) => <span key={t}>{j > 0 && " + "}<button className="underline" onClick={() => setTrail([t])}>{t}</button></span>)}</p>
          <p className="text-muted-foreground">{c.reason} {c.suggestion}</p>
        </div>
      )) : <p className="text-muted-foreground">Nothing obvious. Every table has a distinct shape and a place.</p>}
    </div>
  ) : null;

  // Home: the hub, alone.
  if (!table) {
    const h = byName.get(hub)!;
    return (
      <div className="space-y-3" data-testid="data-map">
        <Header />
        <Consolidations />
        <div className="flex flex-col items-center py-6">
          <button onClick={() => go(hub)} className="w-72 rounded-xl border-2 border-primary bg-primary/5 p-4 text-left hover:bg-primary/10" data-testid={`node-${hub}`}>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1"><Database className="h-3 w-3" />Your main table</p>
            <p className="text-xl font-semibold">{h.name}</p>
            <p className="text-sm text-muted-foreground">{h.rows.toLocaleString()} rows · {h.columns.length} columns · {h.inbound} tables point at it</p>
            <p className="text-xs text-primary mt-2 flex items-center gap-1">Open <ChevronRight className="h-3 w-3" /></p>
          </button>
          <p className="text-xs text-muted-foreground mt-3">Everything else hangs off this. Step in to walk the relations.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="data-map">
      <Header />
      <Consolidations />
      {/* Trail */}
      <div className="flex items-center gap-2 flex-wrap text-sm">
        <Button size="sm" variant="outline" className="h-7" onClick={back} data-testid="map-back"><ArrowLeft className="h-3.5 w-3.5 mr-1" />Back</Button>
        <button className="text-muted-foreground hover:text-foreground" onClick={() => setTrail([])} data-testid="map-home">Home</button>
        {trail.map((t, i) => (
          <span key={i} className="flex items-center gap-2">
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
            {i === trail.length - 1 ? <span className="font-medium">{t}</span> : <button className="text-muted-foreground hover:text-foreground" onClick={() => setTrail(trail.slice(0, i + 1))}>{t}</button>}
          </span>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_20rem]">
        {/* Related tables, one hop away */}
        <div className="space-y-2" data-testid="related-list">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Connected to {table.name} · {related.length}</p>
          {related.length === 0 && <p className="text-sm text-muted-foreground">Nothing points at {table.name} and it points at nothing.</p>}
          {related.map((r) => {
            const t = byName.get(r.name)!;
            const keys = t.columns.filter((c) => c.pk).map((c) => c.name);
            return (
              <div key={`${r.direction}:${r.name}:${r.via}`} className="flex items-center gap-2" data-testid={`related-${r.name}`}>
                <RelationGlyph direction={r.direction} />
                <button onClick={() => go(r.name)} className={`flex-1 min-w-0 rounded-lg border p-3 text-left hover:border-primary/60 ${t.rows === 0 ? "border-dashed border-border" : "border-border bg-background"}`}>
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="font-semibold text-base truncate">{t.name}</p>
                    <p className="text-sm text-muted-foreground shrink-0">{t.rows.toLocaleString()}{t.exact ? "" : "~"} rows</p>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {r.direction === "referenced-by" ? <>many <span className="text-foreground">{t.name}</span> per {table.name}, via <code className="text-xs">{r.via}</code></> : <>each {table.name} has one <span className="text-foreground">{t.name}</span>, via <code className="text-xs">{r.via}</code></>}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">{keys.length ? `PK ${keys.join(", ")} · ` : ""}{t.columns.length} columns · {t.foreignKeys.length} FK{t.foreignKeys.length === 1 ? "" : "s"}</p>
                </button>
                {r.further > 0 ? <FurtherStub count={r.further} /> : <span className="w-[52px] shrink-0" />}
              </div>
            );
          })}
        </div>

        {/* The current table's columns */}
        <div className="rounded-lg border-2 border-primary/60 bg-primary/5 p-3 text-sm space-y-2 self-start" data-testid="current-table">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Current table</p>
            <p className="text-lg font-semibold">{table.name}</p>
            <p className="text-xs text-muted-foreground">{table.rows.toLocaleString()}{table.exact ? "" : "~"} rows · {table.inbound} tables point at it</p>
          </div>
          <ul className="space-y-0.5 max-h-96 overflow-auto text-xs" data-testid="current-columns">
            {table.columns.map((c) => {
              const fk = table.foreignKeys.find((f) => f.column === c.name);
              return (
                <li key={c.name} className="flex justify-between gap-2">
                  <span>{c.pk && <span className="text-primary mr-1 font-semibold">PK</span>}{c.name}{fk && <> → <button className="underline text-primary" onClick={() => go(fk.refTable)}>{fk.refTable}</button></>}</span>
                  <span className="text-muted-foreground shrink-0">{c.type}{c.nullable ? "?" : ""}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
