/**
 * Design tokens for the native app, in both schemes.
 *
 * Tailwind classes don't exist in React Native, so the web app's palette is
 * restated here as plain values — so the phone and the website look like the
 * same product. When a web token changes, change it here too.
 *
 *   --background 0 0% 100%          → background #FFFFFF
 *   --card 0 0% 96.47%              → surface    #F6F6F6
 *   --card-border 0 0% 94%          → border     #F0F0F0
 *   --foreground 0 0% 0%            → text       #000000
 *   --muted-foreground 0 0% 52.94%  → textTertiary #878787
 *   --primary 283.93 44.8% 49.02%   → primary    #9745B5
 *   --accent 254.21 100% 92.55%     → accent     #D9D1FF
 *   --destructive 2.04 74.62% 61.37% → danger    #E65B55
 *
 * ## Dark
 *
 * The neutrals come from the web's own `.dark` block, converted from HSL:
 * `--background 0 0% 0%`, `--card 228 9.8% 10%`, `--border 210 5.26% 14.9%`,
 * `--muted 0 0% 9.41%`, `--foreground 200 6.67% 91.18%`, `--muted-foreground
 * 210 3.39% 46.27%`.
 *
 * The brand colours do **not**. That block also sets `--primary` to a blue
 * (203.77 87.6% 52.5%), which would make this product a different colour after
 * sunset — it is a leftover from the template the web theme started as, and
 * mirroring it here would spread the mistake to a second platform rather than
 * match anything. Purple stays purple; the status colours are lifted a shade
 * because the light-mode versions are tuned for contrast against white.
 *
 * ## How the scheme is chosen
 *
 * Once, at launch, from the system setting — not through a context and a hook.
 *
 * There are about three and a half thousand references to these tokens across
 * a hundred and thirty-eight files, and a fifth of them sit inside
 * `StyleSheet.create` at module scope, which is evaluated once when the file is
 * imported and cannot be re-run. A hook would therefore have to reach every one
 * of those call sites to be honest, and a partial conversion is worse than
 * none: half the screen follows the system and half does not, which reads as a
 * rendering bug rather than a missing feature.
 *
 * So the palette is picked when the app starts. The cost is that changing the
 * system setting while the app is open does not repaint it until the app is
 * opened again — the case people actually hit, a phone that is already dark
 * when they launch, is handled exactly.
 */
import { Appearance } from "react-native";

/** The light scheme, and the shape both schemes have to have. */
const LIGHT = {
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

type Palette = { [K in keyof typeof LIGHT]: string };

const DARK: Palette = {
  background: "#000000",
  /*
   * Darker than the cards on it, which is the inverse of light mode and the
   * whole trick of a dark interface: on white, cards are lighter than the page
   * they sit on; on black they have to be lighter still, or the separation
   * disappears and the screen becomes one flat sheet.
   */
  canvas: "#000000",
  surface: "#17181C",
  surfaceRaised: "#181818",
  border: "#242628",
  borderSubtle: "#1C1E20",

  text: "#E7E9EA",
  textSecondary: "#A1A6AA",
  textTertiary: "#72767A",

  primary: "#B266CE",
  primaryText: "#FFFFFF",
  /** The selected-state tint, as a dark wash rather than a pale one. */
  primarySoft: "#2B1B33",
  accent: "#2E2545",

  /*
   * A shade brighter than light mode's. The light values are chosen to have
   * enough contrast against white; the same greens and ambers on near-black
   * are muddy rather than legible.
   */
  success: "#22C55E",
  warning: "#F59E0B",
  danger: "#F87171",
  info: "#60A5FA",

  novaGreen: "#4ADE80",
  novaEmerald: "#10B981",
  novaPurple: "#A855F7",
};

/**
 * Read once, deliberately: see the note above about `StyleSheet.create`.
 *
 * `Appearance.getColorScheme()` returns null when the platform has no opinion,
 * which is light as far as this app is concerned — and the whole call is
 * optional because these tokens are imported by pure modules (the simulation's
 * lobby and offer rules among them) whose tests run headless, with no React
 * Native runtime behind the import at all. A palette is not worth failing a
 * test about arithmetic over.
 */
export const isDark = Appearance?.getColorScheme?.() === "dark";

export const colors: Palette = isDark ? DARK : LIGHT;

/** Both palettes, for the rare place that needs the one it isn't using. */
export const palettes = { light: LIGHT, dark: DARK } as const;

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
