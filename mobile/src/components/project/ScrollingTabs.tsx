/**
 * An underlined tab strip that keeps the selected tab in view — the project
 * page's and the manager's section tabs, which run well past a phone's width.
 * It looks like ui.tsx's TabStrip; the difference is the scroll-into-view,
 * so a link that opens `?tab=files` shows Files selected, not off-screen — and
 * so a swipe through the project page's sections drags the strip along with it
 * rather than leaving the selected tab somewhere off to the right.
 */
import { useEffect, useRef } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { colors, font, fontFamily, spacing } from "../../theme";

export function ScrollingTabs<T extends string>({ options, value, onChange, testID = "section-tabs" }: {
  options: { value: T; label: string; badge?: string | null }[];
  value: T;
  onChange: (v: T) => void;
  testID?: string;
}) {
  const ref = useRef<ScrollView>(null);
  const xs = useRef<Record<string, { x: number; width: number }>>({});
  const viewport = useRef(0);

  const reveal = (animated: boolean) => {
    const at = xs.current[value];
    if (!at || !viewport.current) return;
    ref.current?.scrollTo({ x: Math.max(0, at.x - (viewport.current - at.width) / 2), animated });
  };
  useEffect(() => { reveal(true); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <ScrollView
      ref={ref}
      testID={testID}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={s.strip}
      contentContainerStyle={{ paddingHorizontal: spacing.md }}
      onLayout={(e) => { viewport.current = e.nativeEvent.layout.width; reveal(false); }}
    >
      {options.map((o) => {
        const on = value === o.value;
        return (
          <Pressable
            key={o.value}
            testID={`${testID}-${o.value}`}
            onPress={() => onChange(o.value)}
            onLayout={(e) => { xs.current[o.value] = { x: e.nativeEvent.layout.x, width: e.nativeEvent.layout.width }; if (on) reveal(false); }}
            style={[s.item, on && s.itemOn]}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
          >
            <Text style={[s.text, on && s.textOn]}>{o.label}</Text>
            {o.badge ? (
              <View style={s.badge}><Text style={s.badgeText}>{o.badge}</Text></View>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  strip: { flexGrow: 0, borderBottomWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  item: { flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: spacing.md, paddingHorizontal: spacing.md, borderBottomWidth: 2, borderColor: "transparent" },
  itemOn: { borderColor: colors.primary },
  text: { color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.medium },
  textOn: { color: colors.primary, fontFamily: fontFamily.semibold },
  badge: { backgroundColor: colors.primary, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1 },
  badgeText: { color: "#FFFFFF", fontSize: 10, fontFamily: fontFamily.semibold },
});
