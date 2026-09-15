import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { planFeedPromotions, rememberSeen, type FeedPromotion } from "@shared/promotions";

const SEEN_KEY = "st_promos_seen";
const HIDDEN_KEY = "st_promos_hidden";
const read = (key: string): string[] => {
  try { const v = JSON.parse(localStorage.getItem(key) ?? "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; }
};
const write = (key: string, value: string[]) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* not remembered, still shown */ } };

/**
 * Which featured tools go where in this visit's feed.
 *
 * A new seed each time the feed mounts, and last visit's seen list read once
 * at mount — so the plan holds still while you scroll, and the next visit to
 * the home page shows a different set, starting with ones you haven't seen.
 * What you see is remembered as it scrolls into view; what you hide stays hidden.
 */
export function useFeedPromotions(postCount: number, enabled: boolean) {
  const { data } = useQuery<{ promotions: FeedPromotion[] }>({ queryKey: ["/api/promotions"], enabled, staleTime: 5 * 60_000 });
  // Your projects' goals, from the same query the path card uses — tools for what you're doing count double.
  const { data: steps } = useQuery<{ items: { track?: { goal: string } | null }[] }>({ queryKey: ["/api/me/next-steps"], enabled });
  const [seed] = useState(() => Math.floor(Math.random() * 2 ** 32));
  const [recentlySeen] = useState(() => read(SEEN_KEY));
  const [hidden, setHidden] = useState(() => read(HIDDEN_KEY));

  const goals = useMemo(() => [...new Set((steps?.items ?? []).map((i) => i.track?.goal).filter(Boolean) as string[])], [steps]);
  const plan = useMemo(() => planFeedPromotions({
    promotions: data?.promotions ?? [], postCount, seed, goals, recentlySeen, hidden,
  }), [data, postCount, seed, goals, recentlySeen, hidden]);

  const byIndex = useMemo(() => {
    const m = new Map<number, { promotion: FeedPromotion; slot: number }>();
    plan.slots.forEach((s, slot) => m.set(s.beforeIndex, { promotion: s.promotion, slot }));
    return m;
  }, [plan]);

  const onSeen = useCallback((id: string) => write(SEEN_KEY, rememberSeen(read(SEEN_KEY), [id])), []);
  const onHide = useCallback((id: string) => {
    const next = [...new Set([id, ...read(HIDDEN_KEY)])].slice(0, 200);
    write(HIDDEN_KEY, next);
    setHidden(next);
  }, []);

  return { promotionBefore: (index: number) => (enabled ? byIndex.get(index) ?? null : null), onSeen, onHide };
}
