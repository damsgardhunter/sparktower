/**
 * Design tokens for the native app.
 *
 * Tailwind classes don't exist in React Native, so the web app's palette is
 * restated here as plain values. Keep these in sync with client/src/index.css
 * so the two apps look like the same product.
 */
export const colors = {
  background: "#0B0F19",
  surface: "#141A28",
  surfaceRaised: "#1B2333",
  border: "#232C40",
  borderSubtle: "#1B2333",

  text: "#F2F5FA",
  textSecondary: "#A7B0C0",
  textTertiary: "#6F7A8D",

  primary: "#4ADE80",
  primaryText: "#07130C",
  accent: "#8B5CF6",

  success: "#34D399",
  warning: "#FBBF24",
  danger: "#F87171",
  info: "#60A5FA",
} as const;

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

/** Post-type accents, mirroring shared/feed.ts on the web. */
export const postTypeColors: Record<string, string> = {
  project_update: "#60A5FA",
  looking_for_help: "#FBBF24",
  looking_for_cofounder: "#A78BFA",
  seeking_feedback: "#22D3EE",
  milestone: "#34D399",
  idea_validation: "#FACC15",
  launch: "#FB7185",
  investor_update: "#94A3B8",
};
