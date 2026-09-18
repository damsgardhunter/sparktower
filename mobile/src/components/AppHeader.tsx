import { useMemo } from "react";
import { Animated, ImageBackground, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, fetchMe } from "../api/client";
import { colors, font, fontFamily, spacing } from "../theme";
import { Avatar, assetUri } from "./ui";
import { useTabBarVisibility } from "./tab-bar-visibility";

/**
 * The top of the app is you: your cover photo, with your face on it.
 *
 * It used to be a utility strip — avatar, a search pill, messages, a menu —
 * which is four controls competing for the most valuable row on the screen and
 * none of them the reason anyone opened the app. Search lives on Discover,
 * messages and More are on the bottom bar now, and the avatar was only ever a
 * doorway to the profile this header now IS.
 *
 * It answers the same scroll as the bottom bar, from the same source: reading
 * the feed slides both away, and coming back up brings both in — the header
 * dropping down from the top, the bar rising from the bottom, at the same
 * moment. One gesture, one response, no second thing to learn.
 *
 * When it's in view it carries the three numbers that answer "is any of this
 * working": views on your projects, people you're connected to, and your
 * builder index. The same three the web keeps in its profile rail, from the
 * same endpoint, so the two can't drift into telling you different things.
 */
export function AppHeader() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const visibility = useTabBarVisibility();

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const { data: summary } = useQuery({
    queryKey: ["/api/profile/summary"],
    queryFn: () => api<{ profile: any; stats: Stats }>("/api/profile/summary"),
    staleTime: 60_000,
  });

  const name = me?.profile?.displayName || me?.user?.firstName || "You";
  const avatarUrl = assetUri(me?.profile?.avatarUrl ?? me?.user?.profileImageUrl) ?? undefined;
  /*
   * Through assetUri: an upload comes back as a path on this API, not an
   * absolute URL, and a bare path renders as nothing on a phone with no
   * console to tell you why.
   */
  const coverUrl = assetUri(summary?.profile?.coverUrl ?? me?.profile?.coverUrl ?? null);
  const stats = summary?.stats;

  /*
   * Slides up out of the way rather than down: a header leaves by the edge it
   * lives on. Same 0→1 value the bottom bar reads, so the two move together
   * instead of drifting a frame apart.
   */
  const hidden = visibility?.hidden;
  const translateY = useMemo(
    () => hidden?.interpolate({ inputRange: [0, 1], outputRange: [0, -(HEADER_HEIGHT + insets.top)] }),
    [hidden, insets.top],
  );

  const body = (
    <Pressable
      onPress={() => router.push("/(tabs)/profile")}
      accessibilityRole="button"
      accessibilityLabel="Your profile"
      testID="header-profile"
      style={{ paddingTop: insets.top }}
    >
      <ImageBackground
        source={coverUrl ? { uri: coverUrl } : undefined}
        style={{ height: HEADER_HEIGHT, justifyContent: "flex-end" }}
        imageStyle={{ resizeMode: "cover" }}
      >
        {/*
         * A wash under the text, always — a cover photo is whatever the person
         * uploaded, and white type over a bright sky is unreadable. It doubles
         * as the background for anyone who hasn't set a cover at all.
         */}
        <View style={{ ...StyleSheetAbsolute, backgroundColor: coverUrl ? "rgba(17,17,20,0.42)" : colors.primary }} />

        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: spacing.md, paddingHorizontal: spacing.md, paddingBottom: spacing.sm }}>
          <View style={{ borderRadius: 999, borderWidth: 2, borderColor: "rgba(255,255,255,0.9)" }}>
            <Avatar name={name} uri={avatarUrl} size={44} />
          </View>

          <View style={{ flex: 1, paddingBottom: 2 }}>
            <Text numberOfLines={1} style={{ color: "#FFFFFF", fontSize: font.base, fontFamily: fontFamily.semibold }}>
              {name}
            </Text>
            {/* The three numbers, on one line: a header is not the place for a table. */}
            <View style={{ flexDirection: "row", gap: spacing.md, marginTop: 1 }} testID="header-stats">
              <Stat label="views" value={stats?.projectViews} />
              <Stat label="connections" value={stats?.connections} />
              <Stat label="index" value={stats?.reputationScore} />
            </View>
          </View>
        </View>
      </ImageBackground>
    </Pressable>
  );

  // No provider (a screen outside the tabs): render it still, just fixed.
  if (!translateY) return <View style={{ backgroundColor: colors.background }}>{body}</View>;

  return (
    <Animated.View style={{ backgroundColor: colors.background, transform: [{ translateY }] }}>
      {body}
    </Animated.View>
  );
}

interface Stats {
  projectViews: number;
  connections: number;
  reputationScore: number | null;
}

/** Bare numbers, because the label under them is the explanation. A dash while loading, never a zero that isn't one. */
function Stat({ label, value }: { label: string; value?: number | null }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "baseline", gap: 3 }}>
      <Text style={{ color: "#FFFFFF", fontSize: font.sm, fontFamily: fontFamily.semibold }}>
        {value == null ? "—" : value.toLocaleString()}
      </Text>
      <Text style={{ color: "rgba(255,255,255,0.75)", fontSize: font.xs, fontFamily: fontFamily.regular }}>{label}</Text>
    </View>
  );
}

/** The header's own height, not counting the status bar above it. */
export const HEADER_HEIGHT = 92;

const StyleSheetAbsolute = { position: "absolute" as const, left: 0, right: 0, top: 0, bottom: 0 };
