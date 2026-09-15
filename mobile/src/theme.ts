/**
 * Design tokens for the native app.
 *
 * Tailwind classes don't exist in React Native, so the web app's palette is
 * restated here as plain values — the light mode of client/src/index.css, so
 * the phone and the website look like the same product. When a web token
 * changes, change it here too.
 *
 *   --background 0 0% 100%          → background #FFFFFF
 *   --card 0 0% 96.47%              → surface    #F6F6F6
 *   --card-border 0 0% 94%          → border     #F0F0F0
 *   --foreground 0 0% 0%            → text       #000000
 *   --muted-foreground 0 0% 52.94%  → textTertiary #878787
 *   --primary 283.93 44.8% 49.02%   → primary    #9745B5
 *   --accent 254.21 100% 92.55%     → accent     #D9D1FF
 *   --destructive 2.04 74.62% 61.37% → danger    #E65B55
 */
export const colors = {
  /** The page. */
  background: "#FFFFFF",
  /** The gray behind a feed of white cards, LinkedIn-style. */
  canvas: "#F3F2EF",
  /** Cards and grouped surfaces, the web's --card. */
  surface: "#FFFFFF",
  /** Inputs, chips and wells: the web's --muted. */
  surfaceRaised: "#F5F5F5",
  border: "#E6E6E6",
  borderSubtle: "#F0F0F0",

  text: "#000000",
  textSecondary: "#5E5E5E",
  textTertiary: "#878787",

  primary: "#9745B5",
  /** Text on the primary colour. */
  primaryText: "#FFFFFF",
  /** A light tint of primary, for selected states. */
  primarySoft: "#F3E8F8",
  accent: "#D9D1FF",

  success: "#16A34A",
  warning: "#D97706",
  danger: "#E65B55",
  info: "#2563EB",

  /** The Nova bot's gradient: green-400 → emerald-500 → purple-500, as on the web's Nova screens. */
  novaGreen: "#4ADE80",
  novaEmerald: "#10B981",
  novaPurple: "#A855F7",
} as const;

/** Nova's gradient, left to right, for the tab bar and Nova moments. */
export const novaGradient = [colors.novaGreen, colors.novaEmerald, colors.novaPurple] as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

export const font = {
  xs: 11,
  sm: 13,
  base: 15,
  lg: 17,
  xl: 22,
  xxl: 28,
} as const;

/**
 * Space Grotesk, the web app's `--font-sans` (client/src/index.css).
 *
 * React Native has no synthetic bolding across weights the way a browser
 * does, so each weight is a separately loaded face and must be named
 * explicitly — `fontWeight` alone won't pick it. The names match the keys
 * registered in app/_layout.tsx.
 */
export const fontFamily = {
  regular: "SpaceGrotesk_400Regular",
  medium: "SpaceGrotesk_500Medium",
  semibold: "SpaceGrotesk_600SemiBold",
  bold: "SpaceGrotesk_700Bold",
} as const;

/** A soft card shadow, the same on iOS and Android. */
export const shadow = {
  card: { shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  raised: { shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8 },
} as const;

/** Post-type accents, mirroring shared/feed.ts on the web. */
export const postTypeColors: Record<string, string> = {
  project_update: "#2563EB",
  looking_for_help: "#D97706",
  looking_for_cofounder: "#7C3AED",
  seeking_feedback: "#0891B2",
  milestone: "#16A34A",
  idea_validation: "#CA8A04",
  launch: "#E11D48",
  investor_update: "#64748B",
};
