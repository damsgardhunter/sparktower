import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { trackEvent } from "@/lib/analytics";
import { ExternalLink, Play, Sparkles, X } from "lucide-react";
import { PROMO_EVENTS, parsePromoVideo, promotionCategoryLabel, type FeedPromotion } from "@shared/promotions";
import { PromoVideoPlayer } from "@/components/promo-video-player";

/** A banner colour per category, for tools without a video yet. */
const CATEGORY_BANNER: Record<string, string> = {
  ai_coding: "from-violet-600 via-fuchsia-500 to-indigo-500",
  models: "from-slate-800 via-indigo-700 to-sky-500",
  hosting: "from-sky-600 via-cyan-500 to-emerald-400",
  backend: "from-emerald-600 via-teal-500 to-cyan-400",
  auth_payments: "from-indigo-600 via-violet-500 to-pink-400",
  design: "from-pink-500 via-rose-400 to-orange-300",
  analytics: "from-amber-500 via-orange-500 to-rose-500",
  workflow: "from-blue-600 via-indigo-500 to-violet-400",
  no_code: "from-teal-500 via-emerald-400 to-lime-300",
  launch: "from-orange-500 via-rose-500 to-fuchsia-500",
  misc: "from-zinc-700 via-slate-600 to-zinc-400",
};

const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };
const initials = (name: string) => name.replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || name.slice(0, 2).toUpperCase();

/**
 * One promotion in the feed, LinkedIn-style: who, what's new, a short
 * video (YouTube and uploaded files play muted while on screen, with sound,
 * pause and title controls over them; Vimeo plays on click), and a link to the company's site — its referral link,
 * with the perk, when one's been set. Marked as a promotion, and as a referral
 * link when it is one, so nobody mistakes it for a builder's post.
 */
export function PromotionCard({ promotion, slot, onSeen, onHide }: {
  promotion: FeedPromotion;
  slot: number;
  onSeen?: (id: string) => void;
  onHide?: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const seenOnce = useRef(false);
  const href = promotion.referralUrl ?? promotion.url;
  const referral = !!promotion.referralUrl;

  // Counted once, when at least half the card has been on screen.
  useEffect(() => {
    const el = ref.current;
    // A preview (no onSeen, as on the admin page) isn't an impression.
    if (!el || !onSeen || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !seenOnce.current) {
        seenOnce.current = true;
        trackEvent(PROMO_EVENTS.impression, { promotionId: promotion.id, slot, referral });
        onSeen?.(promotion.id);
        io.disconnect();
      }
    }, { threshold: 0.5 });
    io.observe(el);
    return () => io.disconnect();
  }, [promotion.id, slot, referral, onSeen]);

  const clicked = () => { if (onSeen) trackEvent(PROMO_EVENTS.click, { promotionId: promotion.id, slot, referral }); };
  const linkProps = {
    href, target: "_blank",
    // A referral link is a paid-for kind of link as far as search engines are concerned.
    rel: referral ? "sponsored noopener noreferrer" : "noopener noreferrer",
    onClick: clicked,
  };

  return (
    <Card ref={ref} className="rounded-lg shadow-none bg-background dark:bg-card overflow-hidden" data-testid={`promo-${promotion.id}`} data-promo-slot={slot}>
      <CardContent className="p-0">
        <div className="flex items-center gap-3 px-4 pt-3 pb-2">
          <a {...linkProps} className="shrink-0" aria-label={`${promotion.name} website`}>
            {promotion.logoUrl
              ? <img src={promotion.logoUrl} alt="" className="h-11 w-11 rounded-md object-contain bg-muted" />
              : <span className={`h-11 w-11 rounded-md bg-gradient-to-br ${CATEGORY_BANNER[promotion.category] ?? CATEGORY_BANNER.misc} text-white font-bold flex items-center justify-center`}>{initials(promotion.name)}</span>}
          </a>
          <div className="min-w-0 flex-1">
            <a {...linkProps} className="font-semibold text-[13px] hover:underline" data-testid={`promo-name-${promotion.id}`}>{promotion.name}</a>
            <p className="text-[11px] text-muted-foreground flex items-center gap-1">
              <Sparkles className="h-3 w-3" /> Promotion · {promotionCategoryLabel(promotion.category)}
            </p>
          </div>
          {onHide && (
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground" onClick={() => onHide(promotion.id)} aria-label={`Hide ${promotion.name}`} data-testid={`promo-hide-${promotion.id}`}>
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        <p className="px-4 pb-3 text-[15px] leading-relaxed" data-testid={`promo-headline-${promotion.id}`}>{promotion.headline ?? promotion.tagline}</p>

        <PromoMedia promotion={promotion} slot={slot} referral={referral} linkProps={linkProps} />

        <div className="flex items-center gap-3 px-4 py-2.5 border-t border-border/60">
          <div className="min-w-0 flex-1">
            <p className="text-[12px] text-muted-foreground truncate">{hostOf(promotion.url)}</p>
            {referral && <p className="text-[10px] text-muted-foreground">Referral link — SparkTower may earn a reward.</p>}
          </div>
          <Button asChild size="sm" className="h-8 gap-1.5 shrink-0" data-testid={`promo-cta-${promotion.id}`}>
            <a {...linkProps}>{promotion.offer ? `Get ${promotion.offer}` : "Visit site"} <ExternalLink className="h-3.5 w-3.5" /></a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PromoMedia({ promotion, slot, referral, linkProps }: {
  promotion: FeedPromotion; slot: number; referral: boolean; linkProps: Record<string, unknown>;
}) {
  const video = parsePromoVideo(promotion.videoUrl);
  const [playing, setPlaying] = useState(false);
  const played = () => trackEvent(PROMO_EVENTS.videoPlay, { promotionId: promotion.id, slot, referral });
  const banner = CATEGORY_BANNER[promotion.category] ?? CATEGORY_BANNER.misc;
  const frame = "relative aspect-video w-full bg-black";

  // YouTube and uploaded files: plays muted on screen, with our own sound, pause and title controls.
  if (video && video.kind !== "vimeo") {
    return (
      <PromoVideoPlayer
        video={video}
        label={`${promotion.name} video`}
        fallbackTitle={promotion.headline ?? promotion.name}
        onFirstPlay={played}
        testId={`promo-video-${promotion.id}`}
      />
    );
  }
  // Vimeo: click to play in its own player.
  if (video && playing) {
    return (
      <div className={frame}>
        <iframe
          src={video.embedUrl}
          title={`${promotion.name} video`}
          className="absolute inset-0 h-full w-full"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          data-testid={`promo-vimeo-${promotion.id}`}
        />
      </div>
    );
  }
  if (video) {
    return (
      <button className={`${frame} group block`} onClick={() => { setPlaying(true); played(); }} aria-label={`Play ${promotion.name} video`} data-testid={`promo-play-${promotion.id}`}>
        <span className={`absolute inset-0 bg-gradient-to-br ${banner}`} />
        <span className="absolute inset-0 flex items-center justify-center bg-black/10 group-hover:bg-black/20 transition-colors">
          <span className="h-14 w-14 rounded-full bg-white/90 flex items-center justify-center shadow-lg"><Play className="h-6 w-6 text-black translate-x-0.5" /></span>
        </span>
      </button>
    );
  }
  // No video yet: a banner in the category's colours, still a way to the site.
  return (
    <a {...(linkProps as any)} className={`relative block aspect-[3/1] w-full bg-gradient-to-br ${banner}`} data-testid={`promo-banner-${promotion.id}`}>
      <span className="absolute inset-0 flex flex-col items-center justify-center text-white text-center px-6">
        {promotion.logoUrl && <img src={promotion.logoUrl} alt="" className="h-14 w-14 rounded-xl object-contain bg-white/90 p-1.5 mb-2 shadow" />}
        <span className="text-2xl font-bold drop-shadow">{promotion.name}</span>
        <span className="text-sm opacity-90 mt-1">{hostOf(promotion.url)}</span>
      </span>
    </a>
  );
}
