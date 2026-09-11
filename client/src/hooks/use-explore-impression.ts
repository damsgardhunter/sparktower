/**
 * "Saw a match": a card at least half on screen, once per visit to the page.
 *
 * Rendering isn't seeing. A grid of thirty cards renders thirty at once while
 * someone looks at the first six, and counting all thirty would make every
 * list look fully read. Half-visible is the usual bar for an impression, and
 * the observer disconnects after the first one, so a card scrolled past twice
 * is still one.
 */
import { useCallback, useEffect, useRef } from "react";
import { EXPLORE_EVENTS, type ExploreProps } from "@shared/explore-events";
import { firstImpression, trackExplore } from "@/lib/explore";

/** Returns a ref for the card. Pass null where the card isn't on an Explore surface — it does nothing. */
export function useExploreImpression(props: ExploreProps | null): (node: HTMLElement | null) => void {
  const observer = useRef<IntersectionObserver | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const key = props ? `${props.source ?? ""}:${props.matchType ?? ""}:${props.targetId ?? ""}` : null;

  useEffect(() => () => observer.current?.disconnect(), []);

  return useCallback((node: HTMLElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node || !key || typeof IntersectionObserver === "undefined") return;
    observer.current = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.current?.disconnect();
      if (latest.current && firstImpression(key)) trackExplore(EXPLORE_EVENTS.viewMatchCard, latest.current);
    }, { threshold: 0.5 });
    observer.current.observe(node);
  }, [key]);
}
