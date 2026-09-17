/**
 * One featured tool between posts — client/src/components/promotion-card.tsx
 * on the phone: who, what's new, the video's poster or a banner in the
 * category's colours, and a link to the company's site (its referral link,
 * with the perk, when one's been set).
 *
 * Marked "Promotion" under the name and "Referral link" beside the button, in
 * the same words the website uses, so nobody mistakes it for a builder's post.
 * The app has no video player, so the poster opens the video in the browser
 * instead of playing inline; that still counts as a play, as it does on the web.
 */
import { useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { LinearGradient } from "expo-linear-gradient";
import Ionicons from "@expo/vector-icons/Ionicons";
import { colors, font, fontFamily, radius, spacing } from "../../theme";
import { assetUri } from "../ui";
import { Box } from "./Box";
import { PROMO_EVENTS, parsePromoVideo, promotionCategoryLabel, type FeedPromotion } from "./promotions";
import { trackPromo } from "./useFeedPromotions";

/** The web's per-category banner gradients (promotion-card.tsx), as colours. */
const CATEGORY_BANNER: Record<string, readonly [string, string, string]> = {
  ai_coding: ["#7C3AED", "#D946EF", "#6366F1"],
  models: ["#1E293B", "#4338CA", "#0EA5E9"],
  hosting: ["#0284C7", "#06B6D4", "#34D399"],
  backend: ["#059669", "#14B8A6", "#22D3EE"],
  auth_payments: ["#4F46E5", "#8B5CF6", "#F472B6"],
  design: ["#EC4899", "#FB7185", "#FDBA74"],
  analytics: ["#F59E0B", "#F97316", "#F43F5E"],
  workflow: ["#2563EB", "#6366F1", "#A78BFA"],
  no_code: ["#14B8A6", "#34D399", "#BEF264"],
  launch: ["#F97316", "#F43F5E", "#D946EF"],
  misc: ["#3F3F46", "#475569", "#A1A1AA"],
};
const banner = (category: string) => CATEGORY_BANNER[category] ?? CATEGORY_BANNER.misc;

const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };
const initials = (name: string) =>
  name.replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase()
  || name.slice(0, 2).toUpperCase();

const openLink = (url: string) => { void WebBrowser.openBrowserAsync(url).catch(() => {}); };

export function PromotionCard({ promotion, slot, onHide }: {
  promotion: FeedPromotion;
  slot: number;
  onHide?: (id: string) => void;
}) {
  const referral = !!promotion.referralUrl;
  const href = promotion.referralUrl ?? promotion.url;
  const event = { promotionId: promotion.id, slot, referral };
  const visit = () => { trackPromo(PROMO_EVENTS.click, event); openLink(href); };

  const video = parsePromoVideo(promotion.videoUrl);
  const play = () => { trackPromo(PROMO_EVENTS.videoPlay, event); openLink(video!.watchUrl); };

  const logo = assetUri(promotion.logoUrl);
  const [logoBroken, setLogoBroken] = useState(false);
  const tile = logo && !logoBroken;

  return (
    <Box padded={false} testID={`promo-${promotion.id}`}>
      <View style={s.head}>
        <Pressable onPress={visit} accessibilityRole="link" accessibilityLabel={`${promotion.name} website`}>
          {tile
            ? <Image source={{ uri: logo }} style={s.logo} resizeMode="contain" onError={() => setLogoBroken(true)} />
            : (
              <LinearGradient colors={banner(promotion.category)} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.logo, s.logoFallback]}>
                <Text style={s.logoText}>{initials(promotion.name)}</Text>
              </LinearGradient>
            )}
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Pressable onPress={visit} accessibilityRole="link">
            <Text style={s.name} numberOfLines={1} testID={`promo-name-${promotion.id}`}>{promotion.name}</Text>
          </Pressable>
          <View style={s.labelRow}>
            <Ionicons name="sparkles-outline" size={11} color={colors.textTertiary} />
            <Text style={s.label} numberOfLines={1}>Promotion · {promotionCategoryLabel(promotion.category)}</Text>
          </View>
        </View>
        {onHide && (
          <Pressable
            onPress={() => onHide(promotion.id)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Hide ${promotion.name}`}
            testID={`promo-hide-${promotion.id}`}
          >
            <Ionicons name="close" size={16} color={colors.textTertiary} />
          </Pressable>
        )}
      </View>

      <Text style={s.headline} testID={`promo-headline-${promotion.id}`}>{promotion.headline ?? promotion.tagline}</Text>

      <PromoMedia promotion={promotion} poster={video?.posterUrl ?? null} onPlay={video ? play : null} onVisit={visit} />

      <View style={s.foot}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.host} numberOfLines={1}>{hostOf(promotion.url)}</Text>
          {referral && <Text style={s.referral}>Referral link — SparkTower may earn a reward.</Text>}
        </View>
        <Pressable
          onPress={visit}
          accessibilityRole="button"
          style={({ pressed }) => [s.cta, pressed && { opacity: 0.9 }]}
          testID={`promo-cta-${promotion.id}`}
        >
          <Text style={s.ctaText}>{promotion.offer ? `Get ${promotion.offer}` : "Visit site"}</Text>
          <Ionicons name="open-outline" size={13} color={colors.primaryText} />
        </Pressable>
      </View>
    </Box>
  );
}

/**
 * The poster of the company's video, or — with no video, or a poster that
 * didn't load — a banner in the category's colours that still goes to the site.
 */
function PromoMedia({ promotion, poster, onPlay, onVisit }: {
  promotion: FeedPromotion;
  poster: string | null;
  onPlay: (() => void) | null;
  onVisit: () => void;
}) {
  const [posterBroken, setPosterBroken] = useState(false);

  if (poster && !posterBroken && onPlay) {
    return (
      <Pressable onPress={onPlay} accessibilityRole="button" accessibilityLabel={`Play the ${promotion.name} video`} testID={`promo-play-${promotion.id}`}>
        <Image source={{ uri: poster }} style={s.poster} resizeMode="cover" onError={() => setPosterBroken(true)} />
        <View style={s.playOverlay} pointerEvents="none">
          <View style={s.playBadge}><Ionicons name="play" size={22} color="#000000" style={{ marginLeft: 2 }} /></View>
        </View>
      </Pressable>
    );
  }

  // A video the app can't show a still of (Vimeo, an uploaded file) is still a
  // video: the banner plays it rather than opening the site.
  const onPress = onPlay ?? onVisit;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" testID={`promo-banner-${promotion.id}`}>
      <LinearGradient colors={banner(promotion.category)} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.bannerBox}>
        {onPlay
          ? <View style={s.playBadge}><Ionicons name="play" size={22} color="#000000" style={{ marginLeft: 2 }} /></View>
          : (
            <>
              <Text style={s.bannerName} numberOfLines={1}>{promotion.name}</Text>
              <Text style={s.bannerHost} numberOfLines={1}>{hostOf(promotion.url)}</Text>
            </>
          )}
      </LinearGradient>
    </Pressable>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.sm },
  logo: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.surfaceRaised },
  logoFallback: { alignItems: "center", justifyContent: "center" },
  logoText: { color: "#FFFFFF", fontSize: font.base, fontFamily: fontFamily.bold },
  name: { color: colors.text, fontSize: font.sm + 1, fontFamily: fontFamily.semibold },
  labelRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 1 },
  label: { color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.regular, flexShrink: 1 },
  headline: { color: colors.text, fontSize: font.base, lineHeight: 21, fontFamily: fontFamily.regular, paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  poster: { width: "100%", aspectRatio: 16 / 9, backgroundColor: "#000000" },
  playOverlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center" },
  playBadge: { width: 52, height: 52, borderRadius: 26, backgroundColor: "rgba(255,255,255,0.92)", alignItems: "center", justifyContent: "center" },
  bannerBox: { width: "100%", aspectRatio: 3, alignItems: "center", justifyContent: "center", gap: 2, paddingHorizontal: spacing.lg },
  bannerName: { color: "#FFFFFF", fontSize: font.xl, fontFamily: fontFamily.bold },
  bannerHost: { color: "rgba(255,255,255,0.9)", fontSize: font.sm, fontFamily: fontFamily.regular },
  foot: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  host: { color: colors.textSecondary, fontSize: 12, fontFamily: fontFamily.regular },
  referral: { color: colors.textTertiary, fontSize: 10, fontFamily: fontFamily.regular, marginTop: 1 },
  cta: { flexDirection: "row", alignItems: "center", gap: 5, height: 32, paddingHorizontal: spacing.md, borderRadius: 6, backgroundColor: colors.primary },
  ctaText: { color: colors.primaryText, fontSize: font.sm, fontFamily: fontFamily.medium },
});
