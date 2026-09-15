/**
 * The profile's own building blocks, restating the website's shadcn Card,
 * CardTitle, Badge and Tabs the way client/src/pages/profile.tsx uses them:
 * rounded white cards on the gray canvas, small uppercase muted card titles,
 * bold section headings, and pill badges.
 *
 * Local to the profile so the shared primitives in ui.tsx stay untouched.
 */
import type { ReactNode } from "react";
import { Pressable, ScrollView, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { colors, font, fontFamily, radius, shadow, spacing } from "../../theme";
import { Icon, type IconName } from "../ui";

/** Side gutter for everything on the profile, like the web's container padding. */
export const GUTTER = spacing.md;

/** The web's <Card>: white, rounded, a hairline border. */
export function PCard({ children, style, tone, dashed, onPress }: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** `primary` is the web's `border-primary/40 bg-primary/5`. */
  tone?: "primary";
  dashed?: boolean;
  onPress?: () => void;
}) {
  const body = (
    <View
      style={[
        {
          backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
          padding: spacing.lg, gap: spacing.md, marginHorizontal: GUTTER, ...shadow.card,
        },
        tone === "primary" && { backgroundColor: "#FAF5FC", borderColor: "#D9B9E6" },
        dashed && { borderStyle: "dashed", shadowOpacity: 0, elevation: 0 },
        dashed && !tone && { backgroundColor: "transparent", borderColor: "#D4D4D4" },
        style,
      ]}
    >
      {children}
    </View>
  );
  if (!onPress) return body;
  return <Pressable onPress={onPress} style={({ pressed }) => pressed && { opacity: 0.7 }}>{body}</Pressable>;
}

/** The web's `CardTitle className="text-sm font-semibold uppercase text-muted-foreground"`, with an optional action. */
export function CardTitle({ icon, iconColor, children, action, onAction, actionIcon }: {
  icon?: IconName;
  iconColor?: string;
  children: ReactNode;
  action?: string;
  onAction?: () => void;
  actionIcon?: IconName;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 }}>
        {icon && <Icon name={icon} size={14} color={iconColor ?? colors.textTertiary} />}
        <Text style={{ fontSize: font.sm, fontFamily: fontFamily.semibold, color: colors.textTertiary, textTransform: "uppercase", letterSpacing: 0.4 }}>
          {children}
        </Text>
      </View>
      {action && onAction && (
        <Pressable onPress={onAction} hitSlop={8} style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: 4 }, pressed && { opacity: 0.6 }]}>
          {actionIcon && <Icon name={actionIcon} size={14} color={colors.primary} />}
          <Text style={{ fontSize: font.sm, fontFamily: fontFamily.semibold, color: colors.primary }}>{action}</Text>
        </Pressable>
      )}
    </View>
  );
}

/** A big card title — the web's `CardTitle` without the muted override ("Editor access", "Donation Earnings"). */
export function StrongTitle({ icon, iconColor, children, right }: { icon?: IconName; iconColor?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, flexShrink: 1 }}>
        {icon && <Icon name={icon} size={20} color={iconColor ?? colors.text} />}
        <Text style={{ fontSize: font.lg, fontFamily: fontFamily.bold, color: colors.text, flexShrink: 1 }}>{children}</Text>
      </View>
      {right}
    </View>
  );
}

/** The web's `<h2 className="text-lg font-bold">` above a list, with a ghost button on the right. */
export function Heading({ icon, children, action, onAction }: { icon?: IconName; children: ReactNode; action?: string; onAction?: () => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: GUTTER + 2, marginTop: spacing.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        {icon && <Icon name={icon} size={18} color={colors.text} />}
        <Text style={{ fontSize: font.lg, fontFamily: fontFamily.bold, color: colors.text }}>{children}</Text>
      </View>
      {action && onAction && (
        <Pressable onPress={onAction} hitSlop={8} style={({ pressed }) => [{ paddingVertical: 4, paddingHorizontal: 8, borderRadius: radius.sm }, pressed && { backgroundColor: colors.surfaceRaised }]}>
          <Text style={{ fontSize: font.sm, fontFamily: fontFamily.semibold, color: colors.text }}>{action}</Text>
        </Pressable>
      )}
    </View>
  );
}

/** The web's `<Badge>` in its variants. */
export function Pill({ label, icon, variant = "outline", color, style }: {
  label: string;
  icon?: IconName;
  variant?: "default" | "secondary" | "outline" | "destructive";
  /** Tints an outline badge — a tier, a post type. */
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const bg = variant === "default" ? colors.primary : variant === "secondary" ? colors.surfaceRaised : variant === "destructive" ? colors.danger : "transparent";
  const fg = variant === "default" || variant === "destructive" ? "#FFFFFF" : color ?? colors.textSecondary;
  return (
    <View style={[{
      flexDirection: "row", alignItems: "center", gap: 3, alignSelf: "flex-start", maxWidth: "100%",
      backgroundColor: bg, borderWidth: 1, borderColor: variant === "outline" ? (color ?? colors.border) : bg,
      borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 1,
    }, style]}>
      {icon && <Icon name={icon} size={11} color={fg} />}
      <Text style={{ fontSize: font.xs, fontFamily: fontFamily.semibold, color: fg, flexShrink: 1 }}>{label}</Text>
    </View>
  );
}

/** A count bubble, the web's destructive `Badge` on the Connections tab. */
export function CountBubble({ n }: { n: number }) {
  return (
    <View style={{ minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.danger, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 }}>
      <Text style={{ color: "#FFFFFF", fontSize: 10, fontFamily: fontFamily.bold }}>{n > 99 ? "99+" : n}</Text>
    </View>
  );
}

/** Dashed empty state: the web's `Card className="border-dashed bg-transparent"`. */
export function EmptyCard({ icon, text, action, actionIcon, onAction }: {
  icon?: IconName; text: string; action?: string; actionIcon?: IconName; onAction?: () => void;
}) {
  return (
    <PCard dashed style={{ alignItems: "center", paddingVertical: spacing.xl, gap: spacing.sm }}>
      {icon && <Icon name={icon} size={30} color={colors.textTertiary} />}
      <Text style={{ fontSize: font.sm, fontFamily: fontFamily.regular, color: colors.textTertiary, textAlign: "center", lineHeight: 19 }}>{text}</Text>
      {action && onAction && (
        <Pressable onPress={onAction} style={({ pressed }) => [outlineBtn, pressed && { opacity: 0.6 }]}>
          {actionIcon && <Icon name={actionIcon} size={15} color={colors.text} />}
          <Text style={{ fontSize: font.sm, fontFamily: fontFamily.semibold, color: colors.text }}>{action}</Text>
        </Pressable>
      )}
    </PCard>
  );
}

/** The web's neutral outline button (`variant="outline"`), as opposed to ui.tsx's purple one. */
export function OutlineButton({ label, icon, onPress, disabled, active, style }: {
  label: string; icon?: IconName; onPress?: () => void; disabled?: boolean; active?: boolean; style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [
      outlineBtn, active && { backgroundColor: colors.surfaceRaised }, (pressed || disabled) && { opacity: 0.6 }, style,
    ]}>
      {icon && <Icon name={icon} size={15} color={colors.text} />}
      <Text style={{ fontSize: font.sm, fontFamily: fontFamily.semibold, color: colors.text }} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

const outlineBtn = {
  flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "center" as const, gap: 6,
  borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radius.pill,
  paddingHorizontal: spacing.md, paddingVertical: 7,
};

export interface ProfileTab<T extends string> { value: T; label: string; count?: number; alert?: number }

/** The profile's TabsList: scrolls sideways, with counts and a red bubble for requests. */
export function ProfileTabs<T extends string>({ tabs, value, onChange }: { tabs: ProfileTab<T>[]; value: T; onChange: (v: T) => void }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0, marginHorizontal: GUTTER }}
      contentContainerStyle={{ gap: 4, padding: 4, backgroundColor: colors.surfaceRaised, borderRadius: radius.sm + 2, borderWidth: 1, borderColor: colors.border }}
    >
      {tabs.map((t) => {
        const on = t.value === value;
        return (
          <Pressable
            key={t.value}
            onPress={() => onChange(t.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={[
              { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.sm },
              on && { backgroundColor: colors.surface, ...shadow.card },
            ]}
          >
            <Text style={{ fontSize: font.sm, fontFamily: on ? fontFamily.semibold : fontFamily.medium, color: on ? colors.text : colors.textSecondary }}>
              {t.label}{t.count ? ` (${t.count})` : ""}
            </Text>
            {!!t.alert && <CountBubble n={t.alert} />}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
