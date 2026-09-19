/**
 * Which featured tools go where in this visit's feed — the app's copy of
 * client/src/hooks/use-feed-promotions.ts.
 *
 * A new seed each time the feed mounts, and the device's seen and hidden lists
 * read once before anything is planned — so the plan holds still while you
 * scroll, and the next visit shows a different set, starting with ones you
 * haven't seen. Growing `postCount` as older posts load only appends slots
 * further down: the draw is seeded, so the ones already on screen keep their
 * places.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, readPref, writePref } from "../../api/client";
import { NEXT_STEPS_KEY, type NextStepItem } from "./ContinuePathCard";
import {
  PROMO_EVENTS, PROMO_HIDDEN_MEMORY, PROMO_STORAGE, parsePromoIds, planFeedPromotions, rememberSeen,
  type FeedPromotion, type PromoEvent,
} from "./promotions";

export interface PromotionSlot {
  promotion: FeedPromotion;
  slot: number;
}

/**
 * Sent one at a time rather than batched, as the app does elsewhere
 * (src/explore.ts): there's no page-unload moment on a phone to flush a queue
 * in, and a lost impression is a promotion that looks unseen.
 */
export function trackPromo(name: PromoEvent, props: { promotionId: string; slot: number; referral: boolean }) {
  void api("/api/track", { method: "POST", body: { events: [{ name, path: "/", props }] } }).catch(() => {});
}

const readIds = async (key: string) => parsePromoIds(await readPref(key).catch(() => null));
const writeIds = (key: string, ids: string[]) => {
  void writePref(key, JSON.stringify(ids)).catch(() => { /* not remembered, still shown */ });
};

export function useFeedPromotions(postCount: number) {
  // Nothing here may take the feed down with it: with the surface off or the
  // request failed there are simply no promotions, and the posts still render.
  const { data } = useQuery({
    queryKey: ["promotions"],
    queryFn: () => api<{ promotions: FeedPromotion[] }>("/api/promotions"),
    staleTime: 5 * 60_000,
    retry: false,
  });
  // Your projects' goals, from the query the path card already made — tools for what you're doing count double.
  const { data: steps } = useQuery({
    queryKey: NEXT_STEPS_KEY,
    queryFn: () => api<{ items: NextStepItem[] }>("/api/me/next-steps"),
  });

  const [seed] = useState(() => Math.floor(Math.random() * 2 ** 32));
  const [remembered, setRemembered] = useState<{ seen: string[]; hidden: string[] } | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.all([readIds(PROMO_STORAGE.seen), readIds(PROMO_STORAGE.hidden)])
      .then(([seen, hidden]) => { if (live) setRemembered({ seen, hidden }); });
    return () => { live = false; };
  }, []);

  const goals = useMemo(
    () => [...new Set((steps?.items ?? []).map((i) => i.track?.goal).filter(Boolean) as string[])],
    [steps],
  );
  const plan = useMemo(() => planFeedPromotions({
    promotions: remembered ? data?.promotions ?? [] : [],
    postCount,
    seed,
    goals,
    recentlySeen: remembered?.seen ?? [],
    hidden: remembered?.hidden ?? [],
  }), [data, postCount, seed, goals, remembered]);

  const byIndex = useMemo(() => {
    const m = new Map<number, PromotionSlot>();
    plan.slots.forEach((s, slot) => m.set(s.beforeIndex, { promotion: s.promotion, slot }));
    return m;
  }, [plan]);

  // One impression per promotion per visit, however often it scrolls back into view.
  const counted = useRef(new Set<string>());
  const onSeen = useCallback(({ promotion, slot }: PromotionSlot) => {
    if (counted.current.has(promotion.id)) return;
    counted.current.add(promotion.id);
    trackPromo(PROMO_EVENTS.impression, { promotionId: promotion.id, slot, referral: !!promotion.referralUrl });
    void readIds(PROMO_STORAGE.seen).then((seen) => writeIds(PROMO_STORAGE.seen, rememberSeen(seen, [promotion.id])));
  }, []);

  // Hidden for good, and gone from this visit's plan as soon as it's written.
  const onHide = useCallback((id: string) => {
    void readIds(PROMO_STORAGE.hidden).then((previous) => {
      const hidden = [...new Set([id, ...previous])].slice(0, PROMO_HIDDEN_MEMORY);
      writeIds(PROMO_STORAGE.hidden, hidden);
      setRemembered((prev) => (prev ? { ...prev, hidden } : prev));
    });
  }, []);

  // Stable while the plan is, so the feed's item list isn't rebuilt every render.
  const promotionBefore = useCallback((index: number) => byIndex.get(index) ?? null, [byIndex]);

  return { promotionBefore, onSeen, onHide };
}
