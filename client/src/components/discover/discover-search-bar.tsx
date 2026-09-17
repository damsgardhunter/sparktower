/**
 * One input and the handful of ways to narrow it.
 *
 * The three pages this replaced each had their own filter bar, so the same
 * word meant different things depending which one you were on. Here there is
 * a single row: what you're looking for, then what kind of thing it is.
 */
import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { PROJECT_GOALS } from "@shared/goals";
import { EMPTY_FILTERS, isBrowsing, type DiscoverFilterState, type DiscoverKind } from "./use-discover-filters";
import { PROJECT_CATEGORIES, PROJECT_STATUSES } from "@shared/categories";

const CATEGORIES = PROJECT_CATEGORIES;

/** The stored words are for the database; these are the ones a person browsing would use. */
const STATUS_LABELS: Record<string, string> = {
  planning: "Still planning",
  active: "Being built",
  completed: "Shipped",
};

/** Radix selects can't hold an empty value, so "any" stands in for "not narrowed". */
const ANY = "any";
const fromAny = (v: string) => (v === ANY ? "" : v);
const toAny = (v: string) => v || ANY;

const KINDS: { value: DiscoverKind; label: string }[] = [
  { value: "all", label: "All" },
  { value: "projects", label: "Projects" },
  { value: "people", label: "People" },
];

interface Props {
  filters: DiscoverFilterState;
  setFilters: (patch: Partial<DiscoverFilterState>, opts?: { replace?: boolean }) => void;
  counts?: { projects: number; people: number };
  isFetching: boolean;
}

export function DiscoverSearchBar({ filters, setFilters, counts, isFetching }: Props) {
  // The input is typed into far faster than the URL should change, so it keeps
  // its own value and pushes to the URL once typing pauses.
  const [text, setText] = useState(filters.q);
  const typed = useRef(false);
  // Filters are out of the way on a phone until asked for; always open above sm.
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    if (!typed.current) return;
    const id = setTimeout(() => {
      typed.current = false;
      setFilters({ q: text.trim() }, { replace: true });
    }, 250);
    return () => clearTimeout(id);
  }, [text, setFilters]);

  // Back button, a link into Discover, "clear" — the URL is the truth, so the
  // box follows it whenever it moved for a reason other than typing.
  useEffect(() => {
    if (!typed.current) setText(filters.q);
  }, [filters.q]);

  const active = [filters.goal, filters.category, filters.shape, filters.needs, filters.status].filter(Boolean).length;
  const browsing = isBrowsing(filters);

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={text}
            onChange={(e) => { typed.current = true; setText(e.target.value); }}
            placeholder="Search projects and people — a skill, a stack, a problem…"
            className="pl-9 h-11 rounded-xl"
            aria-label="Search projects and people"
            data-testid="discover-search"
          />
          {text && (
            <button
              type="button"
              onClick={() => { typed.current = true; setText(""); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
              data-testid="discover-search-clear"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div
          className="hidden sm:inline-flex rounded-xl border border-border bg-muted/40 p-1"
          role="tablist"
          aria-label="What to show"
          data-testid="discover-filter-kind"
        >
          {KINDS.map((k) => (
            <button
              key={k.value}
              role="tab"
              aria-selected={filters.kind === k.value}
              onClick={() => setFilters({ kind: k.value })}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                filters.kind === k.value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              data-testid={`discover-filter-kind-${k.value}`}
            >
              {k.label}
            </button>
          ))}
        </div>

        <Button
          variant="outline"
          className="sm:hidden h-11 rounded-xl shrink-0"
          onClick={() => setShowFilters((v) => !v)}
          aria-expanded={showFilters}
          data-testid="discover-filters-toggle"
        >
          <SlidersHorizontal className="h-4 w-4" />
          {active > 0 && <Badge variant="secondary" className="ml-1.5 px-1.5">{active}</Badge>}
        </Button>
      </div>

      {/* The same controls on every width; only whether they're folded away changes. */}
      <div className={`${showFilters ? "grid" : "hidden"} sm:grid grid-cols-2 lg:grid-cols-4 gap-2`}>
        <div
          className="col-span-2 sm:hidden inline-flex rounded-xl border border-border bg-muted/40 p-1"
          role="tablist"
          aria-label="What to show"
          data-testid="discover-filter-kind-mobile"
        >
          {KINDS.map((k) => (
            <button
              key={k.value}
              role="tab"
              aria-selected={filters.kind === k.value}
              onClick={() => setFilters({ kind: k.value })}
              className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium ${
                filters.kind === k.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
              }`}
              data-testid={`discover-filter-kind-mobile-${k.value}`}
            >
              {k.label}
            </button>
          ))}
        </div>

        <Select value={toAny(filters.goal)} onValueChange={(v) => setFilters({ goal: fromAny(v) })}>
          <SelectTrigger className="rounded-xl" data-testid="discover-filter-goal" aria-label="Goal">
            <SelectValue placeholder="Any goal" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any goal</SelectItem>
            {PROJECT_GOALS.map((g) => (
              <SelectItem key={g.id} value={g.id}>{g.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={toAny(filters.category)} onValueChange={(v) => setFilters({ category: fromAny(v) })}>
          <SelectTrigger className="rounded-xl" data-testid="discover-filter-category" aria-label="Category">
            <SelectValue placeholder="Any category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any category</SelectItem>
            {CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={toAny(filters.shape)} onValueChange={(v) => setFilters({ shape: fromAny(v) })}>
          <SelectTrigger className="rounded-xl" data-testid="discover-filter-shape" aria-label="Solo or team">
            <SelectValue placeholder="Solo or team" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Solo or team</SelectItem>
            <SelectItem value="solo">Solo builds</SelectItem>
            <SelectItem value="team">Team builds</SelectItem>
          </SelectContent>
        </Select>

        <Select value={toAny(filters.status)} onValueChange={(v) => setFilters({ status: fromAny(v) })}>
          <SelectTrigger className="rounded-xl" data-testid="discover-filter-status" aria-label="Project stage">
            <SelectValue placeholder="Any stage" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any stage</SelectItem>
            {PROJECT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          value={filters.needs}
          onChange={(e) => setFilters({ needs: e.target.value }, { replace: true })}
          placeholder="Needs a role — designer, iOS…"
          className="rounded-xl"
          aria-label="Needs a role"
          data-testid="discover-filter-needs"
        />
      </div>

      <div className="flex items-center gap-3 min-h-[1.25rem]">
        {counts ? (
          <p className="text-sm text-muted-foreground" data-testid="discover-counts">
            <span className="font-medium text-foreground">{counts.projects.toLocaleString()}</span>
            {" "}projects · <span className="font-medium text-foreground">{counts.people.toLocaleString()}</span> people
            {isFetching && <span className="ml-2 opacity-60">updating…</span>}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Searching…</p>
        )}
        {!browsing && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => { typed.current = false; setText(""); setFilters(EMPTY_FILTERS); }}
            data-testid="discover-clear-filters"
          >
            <X className="h-3 w-3 mr-1" /> Clear
          </Button>
        )}
      </div>
    </div>
  );
}
