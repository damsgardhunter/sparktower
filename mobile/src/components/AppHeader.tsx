import { useMemo, useState } from "react";
import { Animated, ImageBackground, Pressable, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, fetchMe } from "../api/client";
import { colors, font, fontFamily, novaGradient, spacing } from "../theme";
import { Avatar, Icon, assetUri } from "./ui";
import { useTabBarVisibility } from "./tab-bar-visibility";

/**
 * The top of the app is you: your cover photo, your face on it, and the three
 * numbers that say whether any of this is working.
 *
 * It used to be a utility strip — avatar, search pill, messages, menu — four
 * controls competing for the most valuable row on the screen, none of them the
 * reason anyone opened the app. Search lives on Discover; messages and More
 * are on the bottom bar; the avatar was only ever a door to the profile this
 * header now is.
 *
 * Shaped like the More screen's profile block, because that shape already
 * worked: a band of image, the avatar straddling its bottom edge, and the words
 * below on a clean surface where they're legible without fighting the photo.
 *
 * The cover runs **under the status bar**. The time and the wifi icon sit on
 * the photograph rather than on a strip of background above it, which is what
 * makes it read as a cover rather than a banner someone pasted below the
 * system's furniture — and it's why the status bar is forced light here.
 *
 * It answers the same scroll as the bottom bar, from the same value: reading
 * slides both away, coming back brings both in together. One gesture, one
 * response, nothing new to learn.
 */
export function AppHeader() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const visibility = useTabBarVisibility();
  const [height, setHeight] = useState(220);

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  /*
   * `["profile-summary"]`, the key every other consumer and every invalidation
   * in the app uses (ProfileView, HomeRail, profile/edit, welcome, the feed's
   * pull-to-refresh). This used to be keyed by its URL, which made it a second,
   * private cache entry: editing your name or cover invalidated the other one
   * and this header kept the old avatar, cover, name and numbers for the whole
   * session, while every cold start fetched the same endpoint twice.
   */
  const { data: summary } = useQuery({
    queryKey: ["profile-summary"],
    queryFn: () => api<{ profile: Profile; stats: Stats }>("/api/profile/summary"),
    staleTime: 60_000,
  });

  /*
   * The same key the bar used when the count lived there, so moving the badge
   * moved the query with it rather than adding a second poll for one number.
   */
  const { data: notes } = useQuery({
    queryKey: ["notification-count"],
    queryFn: () => api<{ count: number }>("/api/notifications/unread-count"),
    refetchInterval: 30_000,
  });
  const notifications = notes?.count ?? 0;

  const profile = summary?.profile ?? me?.profile;
  const name = profile?.displayName || me?.user?.firstName || "You";
  const headline = profile?.headline;
  const stats = summary?.stats;

  /*
   * Through assetUri, both of them: an upload comes back as a path on this API
   * rather than an absolute URL, and a bare path renders as nothing at all on a
   * phone — no broken-image icon, no console, just a blank where the photo was.
   */
  const coverUrl = assetUri(profile?.coverUrl, 640);
  const avatarUrl = assetUri(profile?.avatarUrl ?? me?.user?.profileImageUrl) ?? undefined;

  const hidden = visibility?.hidden;
  const translateY = useMemo(
    () => hidden?.interpolate({ inputRange: [0, 1], outputRange: [0, -height] }),
    [hidden, height],
  );

  const body = (
    <Pressable
      onPress={() => router.push("/(tabs)/profile")}
      accessibilityRole="button"
      accessibilityLabel={`${name}. Your profile.`}
      testID="header-profile"
    >
      {/* Light, because it is sitting on a photograph now. */}
      <StatusBar style="light" />

      {/* The photo, from the very top of the screen down past the notch. */}
      <ImageBackground
        source={coverUrl ? { uri: coverUrl } : undefined}
        resizeMode="cover"
        style={{ height: insets.top + COVER_H, justifyContent: "flex-end", backgroundColor: novaGradient[1] }}
        testID="header-cover"
      >
        {!coverUrl && (
          /* No cover yet: the brand gradient rather than a grey hole, and an
             invitation rather than an explanation of the emptiness. */
          <LinearGradient colors={[...novaGradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={ABSOLUTE_FILL} />
        )}
        {/*
         * A scrim only along the bottom, and only faintly. The old version
         * washed the entire photo at 42% black to make white text readable over
         * it — which made every cover look like the same dark rectangle. The
         * words moved below the photo instead, so the scrim now only has to
         * soften the seam.
         */}
        <LinearGradient colors={["transparent", "rgba(0,0,0,0.25)"]} style={{ height: 56 }} />
      </ImageBackground>

      {/* The avatar straddles the edge, as it does on the More screen. */}
      <View style={{ backgroundColor: colors.background, paddingHorizontal: spacing.md, paddingBottom: spacing.md }}>
        <View style={{ marginTop: -AVATAR / 2 }}>
          <Avatar name={name} uri={avatarUrl} size={AVATAR} ring />
        </View>

        <View style={{ marginTop: spacing.sm, gap: 2 }}>
          <Text numberOfLines={1} style={{ color: colors.text, fontSize: font.lg, fontFamily: fontFamily.bold }}>
            {name}
          </Text>
          {headline ? (
            <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.regular }}>
              {headline}
            </Text>
          ) : null}

          {/* The three numbers, on one line: a header is not the place for a table. */}
          <View style={{ flexDirection: "row", gap: spacing.lg, marginTop: 4 }} testID="header-stats">
            <Stat label="views" value={stats?.projectViews} />
            <Stat label="connections" value={stats?.connections} />
            <Stat label="index" value={stats?.reputationScore} />
          </View>
        </View>
      </View>
    </Pressable>
  );

  /*
   * The bell sits on the cover, not on the bar.
   *
   * Notifications had a permanent quarter of the bottom bar — a place you go
   * when something has happened, holding a slot next to the two you use every
   * day. It is a status, so it lives where the rest of your status does, and
   * the slot went to Sprints.
   *
   * A sibling of the profile press rather than a child of it: a button inside
   * a button is a coin toss about which one a thumb on the boundary gets.
   */
  const withBell = (
    <View>
      {body}
      <Pressable
        onPress={() => router.push("/(tabs)/notifications")}
        accessibilityRole="button"
        accessibilityLabel={notifications ? `Notifications, ${notifications} unread` : "Notifications"}
        hitSlop={10}
        testID="header-notifications"
        style={({ pressed }) => [
          {
            position: "absolute",
            right: spacing.md,
            top: insets.top + spacing.sm,
            width: 38, height: 38, borderRadius: 19,
            alignItems: "center", justifyContent: "center",
            // Legible on a photograph, whatever the photograph is.
            backgroundColor: "rgba(0,0,0,0.38)",
          },
          pressed && { opacity: 0.7 },
        ]}
      >
        <Icon name="notifications-outline" size={19} color="#fff" />
        {notifications > 0 && (
          <View style={{
            position: "absolute", top: 2, right: 2, minWidth: 17, height: 17, borderRadius: 9,
            paddingHorizontal: 4, backgroundColor: colors.danger,
            alignItems: "center", justifyContent: "center",
            borderWidth: 2, borderColor: "rgba(0,0,0,0.38)",
          }}>
            <Text style={{ color: "#fff", fontSize: 10, fontFamily: fontFamily.bold }}>
              {notifications > 99 ? "99+" : notifications}
            </Text>
          </View>
        )}
      </Pressable>
    </View>
  );

  // Outside the tabs there's no scroll driving it: render it fixed.
  if (!translateY) return withBell;

  return (
    <Animated.View onLayout={(e) => setHeight(e.nativeEvent.layout.height)} style={{ transform: [{ translateY }] }}>
      {withBell}
    </Animated.View>
  );
}

interface Profile {
  displayName?: string | null;
  headline?: string | null;
  coverUrl?: string | null;
  avatarUrl?: string | null;
}

interface Stats {
  projectViews: number;
  connections: number;
  reputationScore: number | null;
}

/** Bare numbers, because the word under them is the explanation. A dash while loading, never a zero that isn't one. */
function Stat({ label, value }: { label: string; value?: number | null }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4 }}>
      <Text style={{ color: colors.text, fontSize: font.base, fontFamily: fontFamily.bold }}>
        {value == null ? "—" : value.toLocaleString()}
      </Text>
      <Text style={{ color: colors.textSecondary, fontSize: font.xs, fontFamily: fontFamily.regular }}>{label}</Text>
    </View>
  );
}

/**
 * A header with nothing in it but the word.
 *
 * The menu screen used the profile header like every other tab, which put your
 * cover photo, your face, your name and your three numbers above a list of
 * links — and made the whole band a button to your profile. A menu is where
 * you go to get somewhere else; it does not need to show you yourself, and a
 * quarter of that screen was spent doing it. The profile is still one tap
 * away, from the header on every other tab and from the bar.
 */
/**
 * A header about the page you are on.
 *
 * Not every screen is about you. The cover-and-avatar header answers "how is
 * my thing going", which is the right question on the feed and a strange one
 * on a menu, in a conversation list or at a simulation table — your face and
 * your three numbers over a screen that has nothing to do with them, taking a
 * quarter of it. Worse, it made the top of the app change shape as you moved
 * around: it slides away on scroll, so arriving on one of those screens showed
 * it or didn't depending on what you had been reading a moment earlier.
 *
 * So those screens say what they are instead, with a line underneath for what
 * you can do there when that isn't obvious from the title alone.
 */
export function PlainHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{
      paddingTop: insets.top,
      backgroundColor: colors.background,
      borderBottomWidth: 1,
      borderBottomColor: colors.borderSubtle,
    }}>
      <View style={{ height: subtitle ? PLAIN_TALL_H : PLAIN_H, justifyContent: "center", paddingHorizontal: spacing.lg, gap: 1 }}>
        <Text style={{ color: colors.text, fontSize: font.lg, fontFamily: fontFamily.bold }}>{title}</Text>
        {subtitle ? (
          <Text style={{ color: colors.textTertiary, fontSize: font.xs }} numberOfLines={1}>{subtitle}</Text>
        ) : null}
      </View>
    </View>
  );
}

/**
 * What a screen under a PlainHeader must leave clear, since it floats like the
 * other one. `subtitle` has to be told, not guessed: the hook is called by the
 * screen and the header is rendered by the navigator, and they never meet.
 */
export function usePlainHeaderSpace(opts: { subtitle?: boolean } = {}): number {
  const insets = useSafeAreaInsets();
  return insets.top + (opts.subtitle ? PLAIN_TALL_H : PLAIN_H);
}

const PLAIN_H = 48;
const PLAIN_TALL_H = 64;

/**
 * How much room a scrolling screen must leave at the top of its content.
 *
 * The header floats over the scene (headerTransparent in the tabs layout),
 * which is what lets it slide away and reveal content instead of the blank
 * strip it used to leave behind — the scene never grew into the space the
 * header vacated, because the header still owned it.
 *
 * Floating means the screen has to leave the room itself, and it has to be
 * padding INSIDE the scroll content rather than around it: padding around it
 * moves with the screen and the gap comes straight back.
 */
export function useHeaderSpace(): number {
  const insets = useSafeAreaInsets();
  return insets.top + COVER_H + INFO_H;
}

/**
 * How much photograph shows below the status bar.
 *
 * The one number to change if the header feels too tall or too short. On a
 * 6.9" phone this puts the cover at about 160pt including the part behind the
 * status bar, and the whole header at roughly a quarter of the screen — which
 * is only affordable because it slides away the moment you start reading.
 */
const COVER_H = 84;
const AVATAR = 68;
/** The band under the photo: half an avatar, the name, a headline and the three numbers. */
const INFO_H = AVATAR / 2 + 86;

const ABSOLUTE_FILL = { position: "absolute" as const, left: 0, right: 0, top: 0, bottom: 0 };
