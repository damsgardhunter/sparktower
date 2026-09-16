/**
 * The search lives in the URL, not in component state.
 *
 * Discover replaced three destinations, so it is the place people are sent to
 * — "more like this", a shared link, a skill from someone's profile. A search
 * that only existed in React state would break all of that: the back button
 * would leave the page instead of undoing a filter, and nobody could paste
 * what they were looking at. Every control writes here; the query below is a
 * pure function of the address bar.
 */
import { useCallback, useMemo } from "react";
import { useLocation, useSearch } from "wouter";

export type DiscoverKind = "all" | "projects" | "people";

export interface DiscoverFilterState {
  q: string;
  /** A project goal id from @shared/goals; "" for any. */
  goal: string;
  category: string;
  /** "solo" | "team" | "" — the server reads it against a project's soloMode. */
  shape: string;
  /** A role a project is recruiting for, matched loosely. */
  needs: string;
  /** planning | active | completed, or "" for any — what /projects used to filter by. */
  status: string;
  kind: DiscoverKind;
}

export const EMPTY_FILTERS: DiscoverFilterState = {
  q: "", goal: "", category: "", shape: "", needs: "", status: "", kind: "all",
};

const str = (params: URLSearchParams, key: string) => params.get(key)?.trim() ?? "";

export function readDiscoverFilters(params: URLSearchParams): DiscoverFilterState {
  const kind = str(params, "kind");
  const shape = str(params, "shape");
  return {
    q: str(params, "q").slice(0, 80),
    goal: str(params, "goal"),
    category: str(params, "category"),
    shape: shape === "solo" || shape === "team" ? shape : "",
    needs: str(params, "needs"),
    status: str(params, "status"),
    kind: kind === "projects" || kind === "people" ? kind : "all",
  };
}

/** True when nothing is narrowed — the browse experience, which has to look good on its own. */
export const isBrowsing = (f: DiscoverFilterState) =>
  !f.q && !f.goal && !f.category && !f.shape && !f.needs && !f.status && f.kind === "all";

/** The address for a given set of filters. Defaults are left out so a plain browse stays `/discover`. */
export function discoverHref(f: DiscoverFilterState): string {
  const params = new URLSearchParams();
  if (f.q) params.set("q", f.q);
  if (f.goal) params.set("goal", f.goal);
  if (f.category) params.set("category", f.category);
  if (f.shape) params.set("shape", f.shape);
  if (f.needs) params.set("needs", f.needs);
  if (f.status) params.set("status", f.status);
  if (f.kind !== "all") params.set("kind", f.kind);
  const qs = params.toString();
  return qs ? `/discover?${qs}` : "/discover";
}

/** The endpoint for the same filters. Separate from the page address so neither drifts silently. */
export function discoverSearchUrl(f: DiscoverFilterState, limit = 24): string {
  const params = new URLSearchParams();
  if (f.q) params.set("q", f.q);
  if (f.goal) params.set("goal", f.goal);
  if (f.category) params.set("category", f.category);
  if (f.shape) params.set("shape", f.shape);
  if (f.needs) params.set("needs", f.needs);
  if (f.status) params.set("status", f.status);
  params.set("kind", f.kind);
  params.set("limit", String(limit));
  return `/api/discover/search?${params.toString()}`;
}

export function useDiscoverFilters() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const filters = useMemo(() => readDiscoverFilters(new URLSearchParams(search)), [search]);

  /**
   * `replace` is for typing: a history entry per keystroke would make the back
   * button a character-by-character rewind. Picking a filter is a deliberate
   * move and gets its own entry.
   */
  const setFilters = useCallback(
    (patch: Partial<DiscoverFilterState>, opts?: { replace?: boolean }) => {
      navigate(discoverHref({ ...filters, ...patch }), { replace: opts?.replace });
    },
    [filters, navigate],
  );

  return { filters, setFilters };
}
